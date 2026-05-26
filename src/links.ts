import { App, TFile, normalizePath } from 'obsidian'
import { fromMarkdown } from 'mdast-util-from-markdown'

import type { AuthService } from './auth'
import { readMarkdownFileContext } from './frontmatter'
import type {
  ContentType,
  MarkdownFileContext,
} from './types'

interface InternalLinkReference {
  display: string
  end: number
  rawTarget: string
  start: number
  type: 'markdown' | 'wiki'
}

interface MarkdownAstNode {
  children?: MarkdownAstNode[]
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
  type: string
  url?: string
}

interface ResolvedInternalTarget {
  id: string
  path: string | null
  type: ContentType
}

interface ResolveResult {
  relatedIds: string[]
  replacements: Array<{ start: number; end: number; value: string }>
}

export interface InternalLinkResult<T extends MarkdownFileContext = MarkdownFileContext> {
  context: T
  relatedIds: string[]
}

export class InternalLinkService {
  constructor(
    private app: App,
    private api: ReturnType<AuthService['createApiClient']>,
  ) {}

  async prepareContext<T extends MarkdownFileContext>(
    context: T,
    file: TFile,
  ): Promise<InternalLinkResult<T>> {
    const references = collectInternalLinkReferences(context.body)
    if (references.length === 0) {
      return { context, relatedIds: [] }
    }

    const result = await resolveInternalLinks({
      api: this.api,
      app: this.app,
      context,
      file,
      references,
    })

    return {
      context:
        result.replacements.length === 0
          ? context
          : {
              ...context,
              body: applyReplacements(context.body, result.replacements),
            },
      relatedIds: result.relatedIds,
    }
  }
}

function collectInternalLinkReferences(markdown: string): InternalLinkReference[] {
  const references: InternalLinkReference[] = []
  visitMarkdownAst(fromMarkdown(markdown) as MarkdownAstNode, (node) => {
    if (node.type === 'link') {
      const range = nodeRange(node)
      if (!range || !node.url || isExternalOrSpecialUrl(node.url)) return
      const source = markdown.slice(range.start, range.end)
      const display = markdownLinkLabel(source)
      if (!display) return
      references.push({
        display,
        end: range.end,
        rawTarget: normalizeMarkdownDestination(node.url),
        start: range.start,
        type: 'markdown',
      })
      return
    }

    if (node.type !== 'text') return
    const range = nodeRange(node)
    if (!range) return
    references.push(
      ...collectWikiLinks(markdown.slice(range.start, range.end), range.start),
    )
  })

  return references.sort((a, b) => a.start - b.start)
}

export function collectInternalLinkReferencesForTest(
  markdown: string,
): InternalLinkReference[] {
  return collectInternalLinkReferences(markdown)
}

export function buildNotePublicPathForTest(input: {
  created?: string
  nid?: number
  slug?: string
}): string | null {
  return buildNotePublicPath(input)
}

function collectWikiLinks(
  text: string,
  offset: number,
): InternalLinkReference[] {
  const references: InternalLinkReference[] = []
  const pattern = /(^|[^!])\[\[([^\]]+)\]\]/g

  for (const match of text.matchAll(pattern)) {
    const prefix = match[1]
    const body = match[2]
    const localStart = (match.index ?? 0) + prefix.length
    const start = offset + localStart
    const end = start + body.length + 4
    const parts = body.split('|').map((part) => part.trim())
    const rawTarget = parts[0]
    if (!rawTarget) continue
    references.push({
      display: displayTextForWiki(parts[1], rawTarget),
      end,
      rawTarget,
      start,
      type: 'wiki',
    })
  }

  return references
}

async function resolveInternalLinks(input: {
  api: ReturnType<AuthService['createApiClient']>
  app: App
  context: MarkdownFileContext
  file: TFile
  references: InternalLinkReference[]
}): Promise<ResolveResult> {
  const replacements: ResolveResult['replacements'] = []
  const relatedIds: string[] = []
  const relatedSeen = new Set<string>()
  const targetCache = new Map<string, ResolvedInternalTarget | null>()

  for (const reference of input.references) {
    const targetFile = resolveMarkdownFile(input.app, reference.rawTarget, input.file)
    if (!targetFile) continue

    let target = targetCache.get(targetFile.path)
    if (target === undefined) {
      target = await resolvePublishedTarget(input.api, input.app, targetFile)
      targetCache.set(targetFile.path, target)
    }
    if (!target) continue

    if (
      input.context.mx.type === 'post' &&
      target.type === 'post' &&
      target.id !== input.context.mx.id &&
      !relatedSeen.has(target.id)
    ) {
      relatedIds.push(target.id)
      relatedSeen.add(target.id)
    }

    if (target.path) {
      replacements.push({
        end: reference.end,
        start: reference.start,
        value: markdownLink(reference.display, appendSubpath(target.path, reference.rawTarget)),
      })
    }
  }

  return { relatedIds, replacements }
}

async function resolvePublishedTarget(
  api: ReturnType<AuthService['createApiClient']>,
  app: App,
  file: TFile,
): Promise<ResolvedInternalTarget | null> {
  const context = await readMarkdownFileContext(app, file)
  const { id, type } = context.mx
  if (!id || !type) return null
  if ((type === 'post' || type === 'note') && context.mx.publish === false) {
    return null
  }

  const path = await publicPathForTarget(api, context)
  if (!path && type !== 'post') return null
  return { id, path, type }
}

async function publicPathForTarget(
  api: ReturnType<AuthService['createApiClient']>,
  context: MarkdownFileContext,
): Promise<string | null> {
  if (context.mx.type === 'post') {
    if (!context.mx.slug) return null
    return api.resolvePostPath(context.mx.slug)
  }

  if (context.mx.type === 'note') {
    return buildNotePublicPath({
      created: context.publish.created,
      nid: context.mx.nid,
      slug: context.mx.slug,
    })
  }

  if (context.mx.type === 'page') {
    return context.mx.slug ? `/${encodePathPart(context.mx.slug)}` : null
  }

  return null
}

function resolveMarkdownFile(
  app: App,
  rawTarget: string,
  sourceFile: TFile,
): TFile | null {
  if (isExternalOrSpecialUrl(rawTarget)) return null
  const target = stripSubpath(decodeTarget(rawTarget))
  const candidates = new Set<string>([target, rawTarget, stripSubpath(rawTarget)])
  const sourceDir = sourceFile.parent?.path ?? ''
  if (sourceDir) {
    candidates.add(normalizeVaultPath(`${sourceDir}/${target}`))
    candidates.add(normalizeVaultPath(`${sourceDir}/${rawTarget}`))
  }

  for (const candidate of candidates) {
    const linked = app.metadataCache.getFirstLinkpathDest(candidate, sourceFile.path)
    if (linked && isMarkdownFile(linked)) return linked
    const direct = app.vault.getFileByPath(normalizePath(candidate))
    if (direct && isMarkdownFile(direct)) return direct
  }

  return null
}

function normalizeVaultPath(value: string): string {
  const parts: string[] = []
  for (const part of normalizePath(value).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function buildNotePublicPath(input: {
  created?: string
  nid?: number
  slug?: string
}): string | null {
  if (input.created && input.slug) {
    const date = new Date(input.created)
    if (!Number.isNaN(date.valueOf())) {
      return `/notes/${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}/${encodePathPart(input.slug)}`
    }
  }
  return typeof input.nid === 'number' && Number.isFinite(input.nid)
    ? `/notes/${input.nid}`
    : null
}

function visitMarkdownAst(
  node: MarkdownAstNode,
  visitor: (node: MarkdownAstNode) => void,
): void {
  visitor(node)
  for (const child of node.children ?? []) {
    visitMarkdownAst(child, visitor)
  }
}

function nodeRange(
  node: MarkdownAstNode,
): { start: number; end: number } | null {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number') return null
  return { end, start }
}

function markdownLinkLabel(source: string): string | null {
  if (!source.startsWith('[')) return null
  const end = findClosingBracket(source, 1)
  return end > 1 ? source.slice(1, end) : null
}

function findClosingBracket(markdown: string, start: number): number {
  for (let index = start; index < markdown.length; index++) {
    if (markdown[index] === '\\') {
      index++
      continue
    }
    if (markdown[index] === ']') return index
  }
  return -1
}

function normalizeMarkdownDestination(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>')
    return end > 0 ? trimmed.slice(1, end).trim() : trimmed.slice(1).trim()
  }
  return trimmed.replace(/\s+(['"]).*?\1\s*$/, '').trim()
}

function displayTextForWiki(display: string | undefined, target: string): string {
  if (display) return display
  const withoutSubpath = stripSubpath(target)
  return withoutSubpath.split('/').pop()?.replace(/\.md$/i, '') ?? target
}

function appendSubpath(path: string, rawTarget: string): string {
  const subpath = rawTarget.match(/[#^].*$/)?.[0]
  return subpath ? `${path}${subpath.startsWith('#') ? subpath : `#${subpath}`}` : path
}

function stripSubpath(value: string): string {
  const match = value.match(/[#^]/)
  return match?.index === undefined ? value : value.slice(0, match.index)
}

function decodeTarget(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isMarkdownFile(file: TFile): boolean {
  return file.extension.toLowerCase() === 'md'
}

function isExternalOrSpecialUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(value)
}

function markdownLink(label: string, url: string): string {
  return `[${label.replace(/]/g, '\\]')}](${url})`
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value)
}

function applyReplacements(
  source: string,
  replacements: Array<{ start: number; end: number; value: string }>,
): string {
  let next = source
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    next =
      next.slice(0, replacement.start) +
      replacement.value +
      next.slice(replacement.end)
  }
  return next
}
