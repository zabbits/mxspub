import {
  ItemView,
  WorkspaceLeaf,
} from 'obsidian'

import { ensurePublishedBaseFile, MXSPUB_BASE_PATH } from './bases'
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

    const table = this.createTable(container, [
      'Preview',
      'Name',
      'Source',
      'Size',
      'Last used',
      'URL',
    ])
    const tbody = table.createEl('tbody')
    for (const [hash, row] of rows) {
      const tr = tbody.createEl('tr')
      const preview = tr.createEl('td')
      preview.createEl('img', {
        attr: { alt: row.name, src: row.url },
        cls: 'mxspub-management-image-preview',
      })
      tr.createEl('td', { text: row.name || shortHash(hash) })
      tr.createEl('td', { text: row.sourcePath || '-' })
      tr.createEl('td', { text: formatBytes(row.byteSize) })
      tr.createEl('td', { text: formatDate(row.lastUsedAt) })
      const url = tr.createEl('td')
      url.createEl('a', {
        attr: { href: row.url },
        text: row.url,
      })
    }
  }

  private async renderPublished(container: HTMLElement): Promise<void> {
    const baseFile = await ensurePublishedBaseFile(this.app)
    this.renderSummary(container, [['Base file', MXSPUB_BASE_PATH]])
    const panel = container.createDiv({ cls: 'mxspub-management-panel' })
    panel.createEl('p', {
      text: 'Published content opens in a custom Mxspub Base view with native table fallbacks.',
    })
    const button = panel.createEl('button', {
      cls: 'mod-cta',
      text: 'Open Published Base',
    })
    button.addEventListener('click', () => {
      void this.app.workspace.getLeaf('tab').openFile(baseFile)
    })
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

  private createTable(container: HTMLElement, headers: string[]): HTMLTableElement {
    const table = container.createEl('table', {
      cls: 'mxspub-management-table',
    })
    const thead = table.createEl('thead')
    const tr = thead.createEl('tr')
    for (const header of headers) tr.createEl('th', { text: header })
    return table
  }

}

function formatDate(value: string | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return date.toLocaleString()
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

function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, '').slice(0, 12)
}
