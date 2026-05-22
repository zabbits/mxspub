import {
  ItemView,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from 'obsidian'

import { ensurePublishedBaseFile } from './bases'
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
    for (const [, row] of rows) {
      this.renderImageCard(grid, row)
    }
  }

  private renderImageCard(
    container: HTMLElement,
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
    if (sourceFile) {
      media.createEl('img', {
        attr: { alt: row.name, src: this.app.vault.getResourcePath(sourceFile) },
        cls: 'mxspub-management-image-preview',
      })
    } else {
      media.createDiv({
        cls: 'mxspub-management-image-preview is-missing',
        text: 'Missing',
      })
    }
    const body = card.createDiv({ cls: 'mxspub-management-image-body' })
    body.createEl('strong', {
      cls: 'mxspub-management-image-title',
      text: displayPath,
    })
    const details = body.createDiv({ cls: 'mxspub-management-image-details' })
    this.renderImageUrl(details, row.url)
    this.renderImageDetail(details, 'Size', formatBytes(row.byteSize), 'size')
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
