import {
  ItemView,
  TFile,
  WorkspaceLeaf,
  getFrontMatterInfo,
  parseYaml,
} from 'obsidian'

import type {
  ContentType,
  ImageUploadCacheEntry,
  MxSpacePublisherSettings,
  YamlObject,
  YamlValue,
} from './types'

export const MXSPUB_MANAGEMENT_VIEW = 'mxspub-management'

type ManagementTab = 'images' | 'published'

interface PublishedContentRow {
  file: TFile
  id: string
  lastPublishedAt?: string
  slug?: string
  state?: string
  title: string
  type: ContentType
}

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
    const rows = await this.collectPublishedContent()
    this.renderSummary(container, [
      ['Published', String(rows.length)],
      ['Posts', String(rows.filter((row) => row.type === 'post').length)],
      ['Notes', String(rows.filter((row) => row.type === 'note').length)],
      ['Pages', String(rows.filter((row) => row.type === 'page').length)],
    ])

    if (rows.length === 0) {
      this.renderEmpty(container, 'No published content metadata found.')
      return
    }

    const table = this.createTable(container, [
      'Title',
      'Type',
      'State',
      'Slug',
      'Remote ID',
      'Last published',
      'File',
    ])
    const tbody = table.createEl('tbody')
    for (const row of rows) {
      const tr = tbody.createEl('tr')
      tr.createEl('td', { text: row.title })
      tr.createEl('td', { text: row.type })
      tr.createEl('td', { text: row.state || '-' })
      tr.createEl('td', { text: row.slug || '-' })
      tr.createEl('td', { text: row.id })
      tr.createEl('td', { text: formatDate(row.lastPublishedAt) })
      const fileCell = tr.createEl('td')
      const fileLink = fileCell.createEl('button', {
        cls: 'mxspub-management-link-button',
        text: row.file.path,
      })
      fileLink.addEventListener('click', () => {
        void this.app.workspace.getLeaf(false).openFile(row.file)
      })
    }
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

  private async collectPublishedContent(): Promise<PublishedContentRow[]> {
    const rows: PublishedContentRow[] = []
    for (const file of this.app.vault.getMarkdownFiles()) {
      const source = await this.app.vault.cachedRead(file)
      const info = getFrontMatterInfo(source)
      if (!info.exists) continue
      const frontmatter = parseFrontmatter(info.frontmatter)
      const mxspace = frontmatter.mxspace
      if (!isYamlObject(mxspace)) continue
      const id = stringValue(mxspace.id)
      const type = contentTypeValue(mxspace.type)
      if (!id || !type) continue
      rows.push({
        file,
        id,
        lastPublishedAt: stringValue(mxspace.lastPublishedAt),
        slug: stringValue(mxspace.slug),
        state: stringValue(mxspace.state),
        title: stringValue(frontmatter.title) || file.basename,
        type,
      })
    }
    return rows.sort((a, b) =>
      compareDateDesc(a.lastPublishedAt, b.lastPublishedAt),
    )
  }
}

function parseFrontmatter(source: string): YamlObject {
  const parsed = source.trim() ? (parseYaml(source) as YamlValue) : {}
  return isYamlObject(parsed) ? parsed : {}
}

function contentTypeValue(value: YamlValue | undefined): ContentType | undefined {
  return value === 'post' || value === 'note' || value === 'page'
    ? value
    : undefined
}

function stringValue(value: YamlValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isYamlObject(value: YamlValue | undefined): value is YamlObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
