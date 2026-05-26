import {
  ItemView,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from 'obsidian'

import type { AuthService } from './auth'
import { ensurePublishedBaseFile } from './bases'
import { UserFacingError } from './api'
import { confirmAction } from './modals'
import type {
  ImageUploadCacheEntry,
  MxSpacePublisherSettings,
} from './types'

export const MXSPUB_MANAGEMENT_VIEW = 'mxspub-management'

export type ManagementTab = 'images' | 'published'

export class MxspubManagementView extends ItemView {
  private activeTab: ManagementTab = 'images'

  constructor(
    leaf: WorkspaceLeaf,
    private settings: MxSpacePublisherSettings,
    private auth: AuthService,
    private ensureEndpoint: () => Promise<void>,
    private saveSettings: () => Promise<void>,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return MXSPUB_MANAGEMENT_VIEW
  }

  getDisplayText(): string {
    return 'Mxspub'
  }

  getIcon(): string {
    return 'send'
  }

  protected override async onOpen(): Promise<void> {
    this.addAction('refresh-cw', 'Refresh', () => {
      void this.render()
    })
    await this.render()
  }

  async openTab(tab: ManagementTab): Promise<void> {
    this.activeTab = tab
    await this.render()
  }

  async render(): Promise<void> {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('mxspub-management')

    const header = contentEl.createDiv({ cls: 'mxspub-management-header' })
    header.createEl('h2', { text: 'Mxspub' })

    const tabs = header.createDiv({ cls: 'mxspub-management-tabs' })
    this.renderTabButton(tabs, 'images', 'Images')
    this.renderTabButton(tabs, 'published', 'Published')

    const body = contentEl.createDiv({ cls: 'mxspub-management-body' })
    if (this.activeTab === 'images') {
      this.renderImages(body)
      return
    }

    await this.renderPublished(body)
  }

  private renderTabButton(
    container: HTMLElement,
    tab: ManagementTab,
    label: string,
  ): void {
    const button = container.createEl('button', {
      cls: 'mxspub-management-tab',
      text: label,
    })
    button.toggleClass('is-active', this.activeTab === tab)
    button.addEventListener('click', () => {
      if (tab === 'published') {
        void this.openPublishedBase()
        return
      }
      this.activeTab = tab
      void this.render()
    })
  }

  private renderImages(container: HTMLElement): void {
    const rows = Object.entries(this.settings.imageUploadCache)
      .filter(
        (entry): entry is [string, ImageUploadCacheEntry] =>
          Boolean(entry[1]?.url),
      )
      .sort((a, b) => compareDateDesc(a[1].lastUsedAt, b[1].lastUsedAt))

    this.renderSummary(container, [
      ['Images', String(rows.length)],
      ['Total size', formatBytes(rows.reduce((sum, [, row]) => sum + row.byteSize, 0))],
    ])

    if (rows.length === 0) {
      this.renderEmpty(container, 'No uploaded image cache yet.')
      return
    }

    const grid = container.createDiv({ cls: 'mxspub-management-image-list' })
    for (const [hash, row] of rows) {
      this.renderImageCard(grid, hash, row)
    }
  }

  private renderImageCard(
    container: HTMLElement,
    hash: string,
    row: ImageUploadCacheEntry,
  ): void {
    const card = container.createDiv({ cls: 'mxspub-management-image-card' })
    const sourceFile = this.getSourceFile(row.sourcePath)
    const displayPath = row.sourcePath || row.name
    const media = card.createEl('button', {
      cls: 'mxspub-management-image-media',
      attr: { 'aria-label': `Open ${displayPath}` },
    })
    media.addEventListener('click', () => {
      this.openSourceFile(row.sourcePath)
    })
    const preview = imagePreviewForRow(row, sourceFile, (file) =>
      this.app.vault.getResourcePath(file),
    )
    if (preview) {
      const image = media.createEl('img', {
        attr: { alt: row.name, src: preview.src },
        cls: 'mxspub-management-image-preview',
      })
      image.addClass(`is-${preview.type}`)
      if (preview.type === 'excalidraw') {
        image.addEventListener('error', () => {
          image.replaceWith(
            missingPreview('Preview unavailable', 'excalidraw-unavailable'),
          )
        })
      }
    } else if (sourceFile) {
      media.createEl('img', {
        attr: { alt: row.name, src: this.app.vault.getResourcePath(sourceFile) },
        cls: 'mxspub-management-image-preview',
      })
    } else {
      media.appendChild(missingPreview('Missing', 'missing'))
    }
    const body = card.createDiv({ cls: 'mxspub-management-image-body' })
    const header = body.createDiv({ cls: 'mxspub-management-image-card-header' })
    header.createEl('strong', {
      cls: 'mxspub-management-image-title',
      text: displayPath,
    })
    this.renderDeleteButton(header, hash, row, displayPath)
    const details = body.createDiv({ cls: 'mxspub-management-image-details' })
    this.renderImageUrl(details, row.url)
    this.renderImageDetail(details, 'Size', formatBytes(row.byteSize), 'size')
  }

  private renderDeleteButton(
    container: HTMLElement,
    hash: string,
    row: ImageUploadCacheEntry,
    displayPath: string,
  ): void {
    const button = container.createEl('button', {
      attr: { 'aria-label': `Delete ${displayPath}` },
      cls: 'mxspub-management-image-delete',
    })
    setIcon(button, 'trash-2')
    button.addEventListener('click', async () => {
      button.disabled = true
      try {
        await this.deleteImage(hash, row, displayPath)
      } finally {
        button.disabled = false
      }
    })
  }

  private async deleteImage(
    hash: string,
    row: ImageUploadCacheEntry,
    displayPath: string,
  ): Promise<void> {
    const confirmed = await confirmAction(
      this.app,
      'Delete uploaded image',
      `Delete the remote image and remove this cache entry? The local source file will be kept, but published content using this URL may break.\n\n${displayPath}`,
    )
    if (!confirmed) return

    try {
      await this.ensureEndpoint()
      if (!this.auth.hasAnyAuth()) {
        throw new UserFacingError('Select an API key secret in settings first.')
      }
      const api = this.auth.createApiClient()
      await api.deleteImage({ name: row.name, url: row.url })
      delete this.settings.imageUploadCache[hash]
      await this.saveSettings()
      new Notice('Uploaded image deleted.')
      await this.render()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      new Notice(message, 8000)
    }
  }

  private renderImageDetail(
    container: HTMLElement,
    label: string,
    value: string,
    tone: string,
  ): void {
    if (!value || value === '-') return
    const detail = container.createDiv({
      cls: `mxspub-management-image-detail is-${tone}`,
    })
    detail.createEl('span', { text: label })
    detail.createEl('strong', { text: value })
  }

  private renderImageUrl(container: HTMLElement, url: string): void {
    if (!url) return
    const detail = container.createDiv({
      cls: 'mxspub-management-image-detail is-url',
    })
    detail.createEl('span', { text: 'URL' })
    const link = detail.createEl('a', {
      attr: { href: url },
      text: url,
    })
    const icon = detail.createEl('span', {
      attr: { 'aria-hidden': 'true' },
      cls: 'mxspub-management-image-link-icon',
    })
    setIcon(icon, 'external-link')
    link.appendChild(icon)
  }

  private openSourceFile(sourcePath: string): void {
    const file = this.getSourceFile(sourcePath)
    if (!(file instanceof TFile)) return
    void this.app.workspace.getLeaf('tab').openFile(file)
  }

  private getSourceFile(sourcePath: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(sourcePath)
    return file instanceof TFile ? file : null
  }

  private async renderPublished(container: HTMLElement): Promise<void> {
    await this.openPublishedBase()
    this.renderEmpty(container, 'Opening published Base view...')
  }

  private async openPublishedBase(): Promise<void> {
    const baseFile = await ensurePublishedBaseFile(this.app)
    await this.app.workspace.getLeaf('tab').openFile(baseFile)
  }

  private renderSummary(
    container: HTMLElement,
    items: Array<[label: string, value: string]>,
  ): void {
    const summary = container.createDiv({ cls: 'mxspub-management-summary' })
    for (const [label, value] of items) {
      const item = summary.createDiv({ cls: 'mxspub-management-summary-item' })
      item.createEl('span', { text: label })
      item.createEl('strong', { text: value })
    }
  }

  private renderEmpty(container: HTMLElement, message: string): void {
    container.createDiv({ cls: 'mxspub-management-empty', text: message })
  }

}

interface ImagePreview {
  src: string
  type: 'local' | 'excalidraw'
}

function compareDateDesc(a: string | undefined, b: string | undefined): number {
  return dateValue(b) - dateValue(a)
}

function dateValue(value: string | undefined): number {
  if (!value) return 0
  const date = new Date(value).valueOf()
  return Number.isNaN(date) ? 0 : date
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function imagePreviewForRowForTest(
  row: ImageUploadCacheEntry,
  hasSourceFile: boolean,
): ImagePreview | null {
  return imagePreviewForRow(
    row,
    hasSourceFile ? ({ path: row.sourcePath } as TFile) : null,
    (file) => `app://resource/${file.path}`,
  )
}

function imagePreviewForRow(
  row: ImageUploadCacheEntry,
  sourceFile: TFile | null,
  resourcePath: (file: TFile) => string,
): ImagePreview | null {
  if (isExcalidrawSourcePath(row.sourcePath) && row.url) {
    return { src: row.url, type: 'excalidraw' }
  }
  if (sourceFile) return { src: resourcePath(sourceFile), type: 'local' }
  return null
}

function isExcalidrawSourcePath(sourcePath: string): boolean {
  const lower = sourcePath.toLowerCase()
  return lower.endsWith('.excalidraw') || lower.endsWith('.excalidraw.md')
}

function missingPreview(text: string, tone: string): HTMLElement {
  const preview = createDiv({
    cls: `mxspub-management-image-preview is-${tone}`,
    text,
  })
  return preview
}
