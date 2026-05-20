import {
  BasesView,
  setIcon,
  type BasesEntry,
  type BasesPropertyId,
  type BasesViewRegistration,
  type QueryController,
} from 'obsidian'

export const MXSPUB_BASE_VIEW_TYPE = 'mxspub-published-view'

type ContentSection = 'post' | 'note' | 'page'
type EntryState = 'publish' | 'unpublished' | 'page' | 'missing'

interface PublishedEntry {
  category: string
  created: string
  entry: BasesEntry
  id: string
  slug: string
  state: EntryState
  tags: string
  title: string
  topic: string
  type: string
  updated: string
}

const SECTION_LABELS: Record<ContentSection, string> = {
  note: 'Notes',
  page: 'Pages',
  post: 'Posts',
}

const SECTION_ORDER: ContentSection[] = ['post', 'note', 'page']

export function createMxspubBaseViewRegistration(): BasesViewRegistration {
  return {
    factory: (controller, containerEl) =>
      new MxspubPublishedBaseView(controller, containerEl),
    icon: 'send',
    name: 'Mxspub',
  }
}

class MxspubPublishedBaseView extends BasesView {
  type = MXSPUB_BASE_VIEW_TYPE

  constructor(
    controller: QueryController,
    private containerEl: HTMLElement,
  ) {
    super(controller)
  }

  onDataUpdated(): void {
    this.render()
  }

  override onload(): void {
    this.render()
  }

  private render(): void {
    this.containerEl.empty()
    this.containerEl.addClass('mxspub-base-view')

    const entries = this.data?.data.map((entry) => this.readEntry(entry)) ?? []
    this.renderHeader(entries)

    if (entries.length === 0) {
      this.containerEl.createDiv({
        cls: 'mxspub-base-empty',
        text: 'No published content tracked yet.',
      })
      return
    }

    const sections = this.containerEl.createDiv({ cls: 'mxspub-base-sections' })
    for (const section of SECTION_ORDER) {
      this.renderSection(
        sections,
        section,
        entries.filter((entry) => entry.type === section),
      )
    }
  }

  private renderHeader(entries: PublishedEntry[]): void {
    const header = this.containerEl.createDiv({ cls: 'mxspub-base-header' })
    const title = header.createDiv({ cls: 'mxspub-base-title' })
    title.createEl('span', {
      cls: 'mxspub-base-kicker',
      text: 'Mxspub',
    })
    title.createEl('h3', { text: 'Published content' })

    const stats = header.createDiv({ cls: 'mxspub-base-stats' })
    this.renderStat(stats, 'Total', entries.length)
    this.renderStat(
      stats,
      'Published',
      entries.filter((entry) => entry.state === 'publish' || entry.state === 'page')
        .length,
    )
    this.renderStat(
      stats,
      'Unpublished',
      entries.filter((entry) => entry.state === 'unpublished').length,
    )
  }

  private renderStat(container: HTMLElement, label: string, value: number): void {
    const item = container.createDiv({ cls: 'mxspub-base-stat' })
    item.createEl('span', { text: label })
    item.createEl('strong', { text: String(value) })
  }

  private renderSection(
    container: HTMLElement,
    section: ContentSection,
    entries: PublishedEntry[],
  ): void {
    const group = container.createDiv({ cls: 'mxspub-base-section' })
    const header = group.createDiv({ cls: 'mxspub-base-section-header' })
    header.createEl('h4', { text: SECTION_LABELS[section] })
    header.createEl('span', { text: String(entries.length) })

    if (entries.length === 0) {
      group.createDiv({
        cls: 'mxspub-base-section-empty',
        text: `No ${SECTION_LABELS[section].toLowerCase()} tracked.`,
      })
      return
    }

    const list = group.createDiv({ cls: 'mxspub-base-list' })
    for (const entry of entries) {
      this.renderEntry(list, entry)
    }
  }

  private renderEntry(container: HTMLElement, item: PublishedEntry): void {
    const button = container.createEl('button', { cls: 'mxspub-base-entry' })
    button.addEventListener('click', () => {
      void this.app.workspace.getLeaf(false).openFile(item.entry.file)
    })

    if (item.title) {
      const top = button.createDiv({ cls: 'mxspub-base-entry-top' })
      top.createDiv({ cls: 'mxspub-base-entry-title', text: item.title })
    }

    const details = button.createDiv({ cls: 'mxspub-base-entry-details' })
    this.renderFileDetail(details, item)
    this.renderDetail(details, 'Slug', item.slug, 'slug')
    this.renderDetail(
      details,
      this.relationLabel(item),
      this.relationValue(item),
      'relation',
    )
    this.renderTags(details, item.tags)
    this.renderDetail(details, 'Created', item.created, 'created')
    this.renderDetail(details, 'Updated', item.updated, 'time')
    this.renderDetail(details, 'Remote', shortId(item.id), 'remote')
  }

  private renderFileDetail(container: HTMLElement, item: PublishedEntry): void {
    const field = container.createDiv({ cls: 'mxspub-base-detail is-file' })
    field.createEl('span', { text: 'File' })
    const value = field.createDiv({ cls: 'mxspub-base-file-value' })
    value.createEl('strong', { text: item.entry.file.path })
    const status = value.createEl('span', {
      attr: {
        'aria-label': statusLabel(item.state),
        title: statusLabel(item.state),
      },
      cls: `mxspub-base-status-icon is-${item.state}`,
    })
    setIcon(status, statusIcon(item.state))
  }

  private renderDetail(
    container: HTMLElement,
    label: string,
    value: string,
    tone: string,
  ): void {
    if (!value) return
    const field = container.createDiv({
      cls: `mxspub-base-detail is-${tone}`,
    })
    field.createEl('span', { text: label })
    field.createEl('strong', { text: value })
  }

  private renderTags(container: HTMLElement, tags: string): void {
    const items = splitTags(tags)
    if (items.length === 0) return

    const field = container.createDiv({ cls: 'mxspub-base-detail is-tags' })
    field.createEl('span', { text: 'Tags' })
    const list = field.createDiv({ cls: 'mxspub-base-tags' })
    for (const tag of items) {
      list.createEl('strong', { text: tag })
    }
  }

  private readEntry(entry: BasesEntry): PublishedEntry {
    const type = valueOf(entry, 'note.type') || 'post'
    const title = valueOf(entry, 'note.title')
    return {
      category: valueOf(entry, 'note.category'),
      created: valueOf(entry, 'note.created') || valueOf(entry, 'file.ctime'),
      entry,
      id: valueOf(entry, 'note.remoteId'),
      slug: valueOf(entry, 'note.slug'),
      state: entryState(type, valueOf(entry, 'note.publish')),
      tags: valueOf(entry, 'note.tags'),
      title,
      topic: valueOf(entry, 'note.topic'),
      type,
      updated: valueOf(entry, 'note.updated'),
    }
  }

  private relationLabel(item: PublishedEntry): string {
    if (item.type === 'post') return 'Category'
    if (item.type === 'note') return 'Topic'
    if (item.type === 'page') return 'Page'
    return 'Meta'
  }

  private relationValue(item: PublishedEntry): string {
    if (item.type === 'post') return item.category
    if (item.type === 'note') return item.topic
    return item.entry.file.parent?.path ?? ''
  }
}

function entryState(type: string, publish: string): EntryState {
  if (publish === 'true') return 'publish'
  if (publish === 'false') return 'unpublished'
  return type === 'page' ? 'page' : 'missing'
}

function valueOf(entry: BasesEntry, propertyId: BasesPropertyId): string {
  const value = entry.getValue(propertyId)
  if (!value || !value.isTruthy()) return ''
  const normalized = value.toString().trim()
  return normalized === 'null' ? '' : normalized
}

function shortId(value: string): string {
  return value.length > 10 ? value.slice(-10) : value
}

function statusIcon(state: EntryState): string {
  if (state === 'publish') return 'send'
  if (state === 'unpublished') return 'pencil'
  if (state === 'page') return 'file-text'
  return 'circle-alert'
}

function statusLabel(state: EntryState): string {
  if (state === 'publish') return 'Published'
  if (state === 'unpublished') return 'Unpublished'
  if (state === 'page') return 'Page'
  return 'Missing state'
}

function splitTags(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, '')
    .split(/,\s*/)
    .map((item) => item.replace(/^#/, '').trim())
    .filter((item) => Boolean(item) && item !== 'null')
}
