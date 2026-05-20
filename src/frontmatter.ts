import {
  App,
  Notice,
  TFile,
  getFrontMatterInfo,
  parseYaml,
  stringifyYaml,
} from 'obsidian'

import { CONTENT_TYPES } from './types'
import type {
  ContentType,
  MarkdownFileContext,
  MxPublishMetadata,
  NotePublishFrontmatter,
  PagePublishFrontmatter,
  PostPublishFrontmatter,
  PublishFrontmatter,
  YamlObject,
  YamlValue,
} from './types'

const FRONTMATTER_FIELD_ORDER = [
  'title',
  'category',
  'tags',
  'summary',
  'topic',
  'mood',
  'weather',
  'publicAt',
  'location',
  'subtitle',
  'order',
  'created',
  'updated',
  'slug',
  'type',
  'publish',
  'remoteId',
  'published',
]

export function getActiveMarkdownFile(app: App): TFile | null {
  const file = app.workspace.getActiveFile()
  if (!file || file.extension !== 'md') return null
  return file
}

export async function readMarkdownFileContext(
  app: App,
  file: TFile,
): Promise<MarkdownFileContext> {
  const source = await app.vault.cachedRead(file)
  const info = getFrontMatterInfo(source)
  const frontmatter = info.exists
    ? parseFrontmatter(info.frontmatter)
    : {}
  const mx = normalizeMxPublishMetadata(frontmatter)
  const type = mx.type ?? 'post'
  const publish = normalizePublishFrontmatter(type, frontmatter)
  const body = info.exists ? source.slice(info.contentStart) : source

  return {
    body: body.replace(/^\r?\n/, ''),
    fileBasename: file.basename,
    frontmatter,
    mx,
    publish,
    title: resolveContextTitle(publish, file.basename),
  }
}

export interface PublishFrontmatterPatch<T extends ContentType = ContentType> {
  mx?: Partial<MxPublishMetadata>
  publish?: Partial<PublishFrontmatter<T>>
}

export async function updatePublishFrontmatter<T extends ContentType>(
  app: App,
  file: TFile,
  patch: PublishFrontmatterPatch<T>,
): Promise<void> {
  await app.vault.process(file, (source) => {
    const info = getFrontMatterInfo(source)
    const frontmatter = info.exists
      ? parseFrontmatter(info.frontmatter)
      : {}
    if (patch.mx) applyMxPublishPatch(frontmatter, patch.mx)
    if (patch.publish) applyRootPatch(frontmatter, patch.publish)
    const yaml = formatFrontmatterYaml(frontmatter)

    if (info.exists) {
      return `---\n${yaml}---${source.slice(info.to + 3, info.contentStart)}${source.slice(info.contentStart)}`
    }

    return `---\n${yaml}---\n\n${source}`
  })
}

export function updateMxPublishMetadata(
  app: App,
  file: TFile,
  patch: Partial<MxPublishMetadata>,
): Promise<void> {
  return updatePublishFrontmatter(app, file, { mx: patch })
}

export function withMxType(
  context: MarkdownFileContext,
  type: 'post',
): MarkdownFileContext<'post'>
export function withMxType(
  context: MarkdownFileContext,
  type: 'note',
): MarkdownFileContext<'note'>
export function withMxType(
  context: MarkdownFileContext,
  type: 'page',
): MarkdownFileContext<'page'>
export function withMxType(
  context: MarkdownFileContext,
  type: ContentType,
): MarkdownFileContext
export function withMxType<T extends ContentType>(
  context: MarkdownFileContext,
  type: T,
): MarkdownFileContext<T> {
  if (context.mx.type === type) return context as MarkdownFileContext<T>
  const publish = normalizePublishFrontmatter(type, context.frontmatter)
  return {
    ...context,
    mx: { ...context.mx, type },
    publish,
    title: resolveContextTitle(publish, context.fileBasename),
  }
}

export function validContentType(value: YamlValue | undefined): ContentType | undefined {
  return typeof value === 'string' && CONTENT_TYPES.includes(value as ContentType)
    ? (value as ContentType)
    : undefined
}

export function showError(error: Error | string): void {
  const message = error instanceof Error ? error.message : String(error)
  new Notice(message, 8000)
}

function parseFrontmatter(source: string): YamlObject {
  const parsed = source.trim() ? (parseYaml(source) as YamlValue) : {}
  return isYamlObject(parsed) ? parsed : {}
}

function normalizeMxPublishMetadata(value: YamlObject): MxPublishMetadata {
  return {
    id: stringValue(value.remoteId),
    publish: booleanValue(value.publish),
    published: stringValue(value.published),
    slug: stringValue(value.slug),
    type: validContentType(value.type),
    updated: stringValue(value.updated),
  }
}

function normalizePublishFrontmatter(
  type: 'post',
  value: YamlObject,
): PostPublishFrontmatter
function normalizePublishFrontmatter(
  type: 'note',
  value: YamlObject,
): NotePublishFrontmatter
function normalizePublishFrontmatter(
  type: 'page',
  value: YamlObject,
): PagePublishFrontmatter
function normalizePublishFrontmatter(
  type: ContentType,
  value: YamlObject,
): PublishFrontmatter<ContentType>
function normalizePublishFrontmatter<T extends ContentType>(
  type: T,
  value: YamlObject,
): PublishFrontmatter<T> {
  const base = normalizeBaseFrontmatter(value)
  if (type === 'post') {
    return {
      ...base,
      category: normalizeRelation(value.category),
      summary: stringValue(value.summary),
      tags: normalizeTags(value.tags),
    } as PublishFrontmatter<T>
  }
  if (type === 'note') {
    return {
      ...base,
      location: stringValue(value.location),
      mood: stringValue(value.mood),
      publicAt: stringValue(value.publicAt),
      topic: normalizeRelation(value.topic),
      weather: stringValue(value.weather),
    } as PublishFrontmatter<T>
  }
  return {
    ...base,
    order: numberValue(value.order),
    subtitle: stringValue(value.subtitle),
  } as PublishFrontmatter<T>
}

function normalizeBaseFrontmatter(value: YamlObject) {
  return {
    created: stringValue(value.created) || stringValue(value.createdAt),
    slug: stringValue(value.slug),
    title: stringValue(value.title),
  }
}

function normalizeTags(value: YamlValue | undefined): PostPublishFrontmatter['tags'] {
  if (!Array.isArray(value)) return undefined
  const tags = value
    .map((item) => normalizeRelation(item))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  return tags.length ? tags : undefined
}

function normalizeRelation(value: YamlValue | undefined): PostPublishFrontmatter['category'] {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!isYamlObject(value)) return

  return {
    description: stringValue(value.description),
    icon: stringValue(value.icon),
    id: stringValue(value.id),
    name: stringValue(value.name),
    slug: stringValue(value.slug),
  }
}

function resolveContextTitle(
  frontmatter: PublishFrontmatter<ContentType>,
  fallback: string,
): string {
  return stringValue(frontmatter.title) || fallback
}

function stringValue(value: string | YamlValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: YamlValue | undefined): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function booleanValue(value: YamlValue | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function applyMxPublishPatch(
  frontmatter: YamlObject,
  patch: Partial<MxPublishMetadata>,
): void {
  const rootPatch: YamlObject = {}
  if ('published' in patch) rootPatch.published = patch.published
  if ('id' in patch) rootPatch.remoteId = patch.id
  if ('publish' in patch) rootPatch.publish = patch.publish
  if ('type' in patch) rootPatch.type = patch.type
  if ('slug' in patch) rootPatch.slug = patch.slug
  if ('updated' in patch) rootPatch.updated = patch.updated
  applyRootPatch(frontmatter, rootPatch as Partial<PublishFrontmatter<ContentType>>)
}

function applyRootPatch(
  frontmatter: YamlObject,
  patch: Partial<PublishFrontmatter<ContentType>>,
): void {
  for (const [key, item] of Object.entries(patch)) {
    if (item === undefined || item === null || item === '') {
      delete frontmatter[key]
      continue
    }
    if (Array.isArray(item) && item.length === 0) {
      delete frontmatter[key]
      continue
    }
    frontmatter[key] = item as YamlValue
  }
}

function formatFrontmatterYaml(frontmatter: YamlObject): string {
  const sections: string[] = []

  const cleanedRest = orderFrontmatterFields(removeUndefinedDeep(frontmatter))
  if (hasEnumerableValues(cleanedRest)) {
    const restYaml = stringifyYaml(cleanedRest).trim()
    if (restYaml && restYaml !== '{}') sections.push(restYaml)
  }

  return `${sections.join('\n')}\n`
}

function orderFrontmatterFields(value: YamlValue | undefined): YamlObject {
  if (!isYamlObject(value)) return {}
  const ordered: YamlObject = {}
  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      ordered[key] = value[key]
    }
  }
  for (const [key, item] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = item
    }
  }
  return ordered
}

function removeUndefinedDeep(value: YamlValue | undefined): YamlValue | undefined {
  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedDeep(item))
      .filter((item) => item !== undefined)
  }
  if (!isYamlObject(value)) return value

  const result: YamlObject = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue
    result[key] = removeUndefinedDeep(item)
  }
  return result
}

function hasEnumerableValues(value: YamlValue | undefined): value is YamlObject {
  return isYamlObject(value) && Object.keys(value).length > 0
}

function isYamlObject(value: YamlValue | undefined): value is YamlObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
