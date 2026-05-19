import {
  App,
  Notice,
  TFile,
  getFrontMatterInfo,
  parseYaml,
  stringifyYaml,
} from 'obsidian'

import { CONTENT_TYPES, PUBLISH_STATES } from './types'
import type {
  ContentType,
  MarkdownFileContext,
  MxSpaceFrontmatter,
  NotePublishFrontmatter,
  PagePublishFrontmatter,
  PostPublishFrontmatter,
  PublishFrontmatter,
  PublishState,
  YamlObject,
  YamlValue,
} from './types'

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
  const mxspace = normalizeMxspace(frontmatter.mxspace)
  const type = mxspace.type ?? 'post'
  const publish = normalizePublishFrontmatter(type, frontmatter)
  const body = info.exists ? source.slice(info.contentStart) : source

  return {
    body: body.replace(/^\r?\n/, ''),
    fileBasename: file.basename,
    frontmatter,
    mxspace,
    publish,
    title: resolveContextTitle(publish, file.basename),
  }
}

export interface PublishFrontmatterPatch<T extends ContentType = ContentType> {
  mxspace?: Partial<MxSpaceFrontmatter>
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
    const current = normalizeMxspace(frontmatter.mxspace)
    frontmatter.mxspace = removeEmptyMxspaceValues({
      ...current,
      ...(patch.mxspace ?? {}),
    })
    if (patch.publish) applyRootPatch(frontmatter, patch.publish)
    const yaml = formatFrontmatterYaml(frontmatter)

    if (info.exists) {
      return `---\n${yaml}---${source.slice(info.to + 3, info.contentStart)}${source.slice(info.contentStart)}`
    }

    return `---\n${yaml}---\n\n${source}`
  })
}

export function updateMxspaceFrontmatter(
  app: App,
  file: TFile,
  patch: Partial<MxSpaceFrontmatter>,
): Promise<void> {
  return updatePublishFrontmatter(app, file, { mxspace: patch })
}

export function withMxspaceType(
  context: MarkdownFileContext,
  type: 'post',
): MarkdownFileContext<'post'>
export function withMxspaceType(
  context: MarkdownFileContext,
  type: 'note',
): MarkdownFileContext<'note'>
export function withMxspaceType(
  context: MarkdownFileContext,
  type: 'page',
): MarkdownFileContext<'page'>
export function withMxspaceType(
  context: MarkdownFileContext,
  type: ContentType,
): MarkdownFileContext
export function withMxspaceType<T extends ContentType>(
  context: MarkdownFileContext,
  type: T,
): MarkdownFileContext<T> {
  if (context.mxspace.type === type) return context as MarkdownFileContext<T>
  const publish = normalizePublishFrontmatter(type, context.frontmatter)
  return {
    ...context,
    mxspace: { ...context.mxspace, type },
    publish,
    title: resolveContextTitle(publish, context.fileBasename),
  }
}

export function validPublishState(value: YamlValue | undefined): PublishState | undefined {
  return typeof value === 'string' &&
    PUBLISH_STATES.includes(value as PublishState)
    ? (value as PublishState)
    : undefined
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

function normalizeMxspace(value: YamlValue | undefined): MxSpaceFrontmatter {
  if (!isYamlObject(value)) return {}
  return {
    id: stringValue(value.id),
    lastPublishedAt: stringValue(value.lastPublishedAt),
    slug: stringValue(value.slug),
    state: validPublishState(value.state),
    type: validContentType(value.type),
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
    mxspace: normalizeMxspace(value.mxspace),
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

function removeEmptyMxspaceValues(
  value: Partial<MxSpaceFrontmatter>,
): Partial<MxSpaceFrontmatter> {
  const next: Partial<MxSpaceFrontmatter> = {}
  for (const key of Object.keys(value) as Array<keyof MxSpaceFrontmatter>) {
    const item = value[key]
    if (item === undefined || item === null || item === '') continue
    if (Array.isArray(item) && item.length === 0) continue
    ;(next as YamlObject)[key] = item as YamlValue
  }
  return next
}

function applyRootPatch(
  frontmatter: YamlObject,
  patch: Partial<PublishFrontmatter<ContentType>>,
): void {
  for (const [key, item] of Object.entries(patch)) {
    if (key === 'mxspace') continue
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
  const { mxspace, ...rest } = frontmatter
  const sections: string[] = []

  const cleanedRest = removeUndefinedDeep(rest)
  if (hasEnumerableValues(cleanedRest)) {
    const restYaml = stringifyYaml(cleanedRest).trim()
    if (restYaml && restYaml !== '{}') sections.push(restYaml)
  }

  if (isYamlObject(mxspace)) {
    sections.push(formatMxspaceYaml(mxspace))
  }

  return `${sections.join('\n')}\n`
}

function formatMxspaceYaml(mxspace: YamlObject): string {
  const cleaned = removeUndefinedDeep(mxspace)
  if (!hasEnumerableValues(cleaned)) return 'mxspace: {}'

  const body = stringifyYaml(cleaned)
    .trim()
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join('\n')
  return body ? `mxspace:\n${body}` : 'mxspace: {}'
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
