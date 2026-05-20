import { makeSlug, relationLabel } from './slug'
import { markdownToEditorStateJson } from './lexical'
import type {
  BaseWritePayload,
  ContentType,
  MarkdownFileContext,
  MxNotePayload,
  MxPagePayload,
  MxPostPayload,
  NotePublishFrontmatter,
  PublishPayload,
  PublishState,
  RelationInput,
  YamlValue,
} from './types'

export interface RelationPayload {
  categoryId?: string
  tags?: string[]
  topicId?: string
}

export interface PayloadInput<T extends ContentType = ContentType> {
  context: MarkdownFileContext<T>
  type: T
  state: PublishState
  relations: RelationPayload
}

type AnyPayloadInput =
  | PayloadInput<'post'>
  | PayloadInput<'note'>
  | PayloadInput<'page'>

export function buildPayload(input: PayloadInput<'post'>): MxPostPayload
export function buildPayload(input: PayloadInput<'note'>): MxNotePayload
export function buildPayload(input: PayloadInput<'page'>): MxPagePayload
export function buildPayload(input: AnyPayloadInput): PublishPayload {
  if (input.type === 'post') return buildPostPayload(input)
  if (input.type === 'note') return buildNotePayload(input)
  return buildPagePayload(input)
}

export function resolveTitle(context: MarkdownFileContext): string {
  return stringValue(context.publish.title) || context.fileBasename
}

export function resolveSlug(context: MarkdownFileContext): string {
  return stringValue(context.publish.slug) || makeSlug(context.fileBasename)
}

function buildBasePayload(input: PayloadInput): BaseWritePayload {
  const payload: BaseWritePayload = {
    content: markdownToEditorStateJson(input.context.body),
    contentFormat: 'markdown',
    slug: resolveSlug(input.context),
    text: input.context.body,
    title: resolveTitle(input.context),
  }
  if (input.context.publish.created) {
    payload.created = input.context.publish.created
  }
  return payload
}

function buildPostPayload(input: PayloadInput<'post'>): MxPostPayload {
  const base = buildBasePayload(input)
  const payload: MxPostPayload = {
    ...base,
    categoryId: input.relations.categoryId,
    isPublished: input.state === 'publish',
    slug: base.slug ?? resolveSlug(input.context),
  }
  if (input.relations.tags?.length) payload.tags = input.relations.tags
  if (input.context.publish.summary) payload.summary = input.context.publish.summary
  return payload
}

function buildNotePayload(input: PayloadInput<'note'>): MxNotePayload {
  const payload: MxNotePayload = {
    ...buildBasePayload(input),
    isPublished: input.state === 'publish',
  }
  if (input.relations.topicId) payload.topicId = input.relations.topicId
  copyStringIfPresent(payload, input.context.publish, [
    'mood',
    'weather',
    'publicAt',
    'location',
  ])
  return payload
}

function buildPagePayload(input: PayloadInput<'page'>): MxPagePayload {
  const base = buildBasePayload(input)
  const payload: MxPagePayload = {
    ...base,
    slug: base.slug ?? resolveSlug(input.context),
  }
  if (input.context.publish.subtitle) {
    payload.subtitle = input.context.publish.subtitle
  }
  if (typeof input.context.publish.order === 'number') {
    payload.order = input.context.publish.order
  }
  return payload
}

function copyStringIfPresent(
  payload: MxNotePayload,
  source: NotePublishFrontmatter,
  keys: Array<
    keyof Pick<NotePublishFrontmatter, 'mood' | 'weather' | 'publicAt' | 'location'>
  >,
): void {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) {
      payload[key] = value
    }
  }
}

function stringValue(value: string | YamlValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeRelationValue(
  value: RelationInput | undefined,
): string | undefined {
  return relationLabel(value)
}
