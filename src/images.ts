import { App, TFile, normalizePath } from 'obsidian'
import { fromMarkdown } from 'mdast-util-from-markdown'

import type { AuthService } from './auth'
import { UserFacingError } from './api'
import type {
  ImageUploadCacheEntry,
  MarkdownFileContext,
  MxSpacePublisherSettings,
} from './types'

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
])

const EXCALIDRAW_SVG_PADDING = 10
const EXCALIDRAW_SVG_THEME = 'light'

interface ImageReference {
  alt: string
  rawTarget: string
  start: number
  end: number
  type: 'markdown' | 'wiki'
}

interface MarkdownAstNode {
  alt?: string | null
  children?: MarkdownAstNode[]
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
  type: string
  url?: string
  value?: string
}

interface UploadableImage {
  contentType: string
  data: ArrayBuffer
  filename: string
  sourcePath: string
}

interface ExcalidrawAutomateApi {
  createSVG?: (...args: unknown[]) => Promise<unknown> | unknown
  isExcalidrawFile?: (file: TFile) => boolean
  reset?: () => void
}

export class ImageUploadService {
  constructor(
    private app: App,
    private settings: MxSpacePublisherSettings,
    private api: ReturnType<AuthService['createApiClient']>,
    private saveSettings: () => Promise<void>,
  ) {}

  async prepareContext<T extends MarkdownFileContext>(
    context: T,
    file: TFile,
  ): Promise<T> {
    const references = collectImageReferences(context.body)
    if (references.length === 0) return context

    const replacements: Array<{ start: number; end: number; value: string }> = []
    const uploadCache = new Map<string, ImageUploadCacheEntry>()
    let cacheChanged = false

    for (const reference of references) {
      if (isExternalOrDataUrl(reference.rawTarget)) continue
      if (
        isExcalidrawTarget(reference.rawTarget) &&
        !this.settings.exportExcalidrawAsSvg
      ) {
        continue
      }

      const mediaFile = resolvePublishableMediaFile(
        this.app,
        reference.rawTarget,
        file,
      )
      if (!mediaFile) {
        throw new UserFacingError(
          `Cannot find image referenced by ${reference.rawTarget}.`,
        )
      }

      const uploadable = await this.prepareUploadableImage(mediaFile)
      const entry = await this.uploadImage(uploadable, uploadCache)
      if (entry.changed) cacheChanged = true
      replacements.push({
        end: reference.end,
        start: reference.start,
        value: markdownImage(reference.alt || mediaFile.basename, entry.cache.url),
      })
    }

    if (replacements.length === 0) return context
    if (cacheChanged) await this.saveSettings()

    return {
      ...context,
      body: applyReplacements(context.body, replacements),
    }
  }

  private async prepareUploadableImage(file: TFile): Promise<UploadableImage> {
    if (isImageFile(file)) {
      return {
        contentType: mimeTypeForFile(file),
        data: await this.app.vault.readBinary(file),
        filename: file.name,
        sourcePath: file.path,
      }
    }

    if (isExcalidrawFileCandidate(file)) {
      return this.exportExcalidrawSvg(file)
    }

    throw new UserFacingError(`Unsupported image reference: ${file.path}.`)
  }

  private async exportExcalidrawSvg(file: TFile): Promise<UploadableImage> {
    const automate = excalidrawAutomate()
    if (!automate?.createSVG) {
      throw new UserFacingError(
        'Enable or update the Excalidraw plugin to publish Excalidraw embeds.',
      )
    }

    if (automate.isExcalidrawFile && !automate.isExcalidrawFile(file)) {
      throw new UserFacingError(`Cannot export Excalidraw file: ${file.path}.`)
    }

    try {
      automate.reset?.()
      const svg = await automate.createSVG(
        file.path,
        false,
        { withBackground: false },
        undefined,
        EXCALIDRAW_SVG_THEME,
        EXCALIDRAW_SVG_PADDING,
        false,
        false,
      )
      return {
        contentType: 'image/svg+xml',
        data: svgToArrayBuffer(svg),
        filename: `${excalidrawBasename(file)}.svg`,
        sourcePath: file.path,
      }
    } catch (error) {
      throw new UserFacingError(
        `Cannot export Excalidraw SVG for ${file.path}: ${errorMessage(error)}`,
      )
    }
  }

  private async uploadImage(
    image: UploadableImage,
    publishCache: Map<string, ImageUploadCacheEntry>,
  ): Promise<{ cache: ImageUploadCacheEntry; changed: boolean }> {
    const hash = `sha256:${await sha256Hex(image.data)}`
    const now = new Date().toISOString()
    const cached = publishCache.get(hash) ?? this.settings.imageUploadCache[hash]

    if (cached?.url && cached.name) {
      const next: ImageUploadCacheEntry = {
        ...cached,
        lastUsedAt: now,
        sourcePath: image.sourcePath,
      }
      this.settings.imageUploadCache[hash] = next
      publishCache.set(hash, next)
      return {
        cache: next,
        changed:
          next.lastUsedAt !== cached.lastUsedAt ||
          next.sourcePath !== cached.sourcePath,
      }
    }

    const response = await this.api.uploadImage({
      contentType: image.contentType,
      data: image.data,
      filename: image.filename,
    })
    const entry: ImageUploadCacheEntry = {
      byteSize: image.data.byteLength,
      lastUsedAt: now,
      name: response.name,
      sourcePath: image.sourcePath,
      uploadedAt: now,
      url: response.url,
    }
    this.settings.imageUploadCache[hash] = entry
    publishCache.set(hash, entry)
    return { cache: entry, changed: true }
  }
}

function collectImageReferences(markdown: string): ImageReference[] {
  const references: ImageReference[] = []
  visitMarkdownAst(fromMarkdown(markdown) as MarkdownAstNode, (node) => {
    if (node.type === 'image') {
      const range = nodeRange(node)
      if (!range || !node.url) return
      references.push({
        alt: node.alt ?? '',
        end: range.end,
        rawTarget: node.url,
        start: range.start,
        type: 'markdown',
      })
      return
    }

    if (node.type !== 'text') return
    const range = nodeRange(node)
    if (!range) return
    const source = markdown.slice(range.start, range.end)
    references.push(
      ...collectMarkdownImageTextFallbacks(source, range.start),
      ...collectWikiImageEmbeds(source, range.start),
    )
  })
  return references.sort((a, b) => a.start - b.start)
}

export function collectImageReferencesForTest(markdown: string): ImageReference[] {
  return collectImageReferences(markdown)
}

function collectWikiImageEmbeds(text: string, offset: number): ImageReference[] {
  const references: ImageReference[] = []
  const pattern = /!\[\[([^\]]+)\]\]/g
  for (const match of text.matchAll(pattern)) {
    const start = offset + match.index
    const end = start + match[0].length
    const parts = match[1].split('|').map((part) => part.trim())
    const rawTarget = parts[0]
    if (!rawTarget) continue
    references.push({
      alt: displayTextForWiki(parts[1], rawTarget),
      end,
      rawTarget,
      start,
      type: 'wiki',
    })
  }
  return references
}

function collectMarkdownImageTextFallbacks(
  text: string,
  offset: number,
): ImageReference[] {
  const references: ImageReference[] = []
  let index = 0

  while (index < text.length) {
    const localStart = text.indexOf('![', index)
    if (localStart < 0) break

    const altEnd = findClosingBracket(text, localStart + 2)
    if (altEnd < 0 || text[altEnd + 1] !== '(') {
      index = localStart + 2
      continue
    }

    const destination = parseMarkdownDestination(text, altEnd + 1)
    if (!destination) {
      index = localStart + 2
      continue
    }

    const rawTarget = normalizeMarkdownDestination(destination.value)
    if (!rawTarget) {
      index = destination.end
      continue
    }

    references.push({
      alt: text.slice(localStart + 2, altEnd).replace(/\\]/g, ']').trim(),
      end: offset + destination.end,
      rawTarget,
      start: offset + localStart,
      type: 'markdown',
    })
    index = destination.end
  }

  return references
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

function parseMarkdownDestination(
  markdown: string,
  openParenIndex: number,
): { value: string; end: number } | null {
  let depth = 0
  for (let index = openParenIndex + 1; index < markdown.length; index++) {
    const char = markdown[index]
    if (char === '\\') {
      index++
      continue
    }
    if (char === '(') {
      depth++
      continue
    }
    if (char !== ')') continue
    if (depth > 0) {
      depth--
      continue
    }
    return {
      end: index + 1,
      value: markdown.slice(openParenIndex + 1, index),
    }
  }
  return null
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
  if (!display || /^\d+(x\d+)?$/i.test(display)) {
    return target.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
  }
  return display
}

function resolvePublishableMediaFile(
  app: App,
  rawTarget: string,
  sourceFile: TFile,
): TFile | null {
  const target = stripSubpath(decodeTarget(rawTarget))
  const candidates = new Set<string>([target, rawTarget, stripSubpath(rawTarget)])
  const sourceDir = sourceFile.parent?.path ?? ''
  if (sourceDir) {
    candidates.add(normalizePath(`${sourceDir}/${target}`))
    candidates.add(normalizePath(`${sourceDir}/${rawTarget}`))
  }

  for (const candidate of candidates) {
    const linked = app.metadataCache.getFirstLinkpathDest(candidate, sourceFile.path)
    if (linked && isPublishableMediaFile(linked)) return linked
    const direct = app.vault.getFileByPath(normalizePath(candidate))
    if (direct && isPublishableMediaFile(direct)) return direct
  }

  return null
}

function stripSubpath(value: string): string {
  const hashIndex = value.indexOf('#')
  return hashIndex >= 0 ? value.slice(0, hashIndex) : value
}

function decodeTarget(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isImageFile(file: TFile): boolean {
  return IMAGE_EXTENSIONS.has(file.extension.toLowerCase())
}

function isPublishableMediaFile(file: TFile): boolean {
  return isImageFile(file) || isExcalidrawFileCandidate(file)
}

function isExcalidrawFileCandidate(file: TFile): boolean {
  const path = file.path.toLowerCase()
  return file.extension.toLowerCase() === 'excalidraw' || path.endsWith('.excalidraw.md')
}

function isExcalidrawTarget(rawTarget: string): boolean {
  const target = stripSubpath(decodeTarget(rawTarget)).toLowerCase()
  return target.endsWith('.excalidraw') || target.endsWith('.excalidraw.md')
}

function isExternalOrDataUrl(value: string): boolean {
  return /^(https?:|data:|app:|file:|obsidian:)/i.test(value)
}

function markdownImage(alt: string, url: string): string {
  return `![${escapeMarkdownAlt(alt)}](${url})`
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/]/g, '\\]')
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

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function mimeTypeForFile(file: TFile): string {
  switch (file.extension.toLowerCase()) {
    case 'avif':
      return 'image/avif'
    case 'gif':
      return 'image/gif'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'svg':
      return 'image/svg+xml'
    case 'webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function excalidrawAutomate(): ExcalidrawAutomateApi | null {
  const candidate = (globalThis as { ExcalidrawAutomate?: unknown })
    .ExcalidrawAutomate
  if (!candidate || typeof candidate !== 'object') return null
  return candidate as ExcalidrawAutomateApi
}

function svgToArrayBuffer(svg: unknown): ArrayBuffer {
  return new TextEncoder().encode(svgToString(svg)).buffer
}

function svgToString(svg: unknown): string {
  if (typeof svg === 'string') return svg
  if (svg && typeof svg === 'object') {
    if (typeof XMLSerializer !== 'undefined') {
      return new XMLSerializer().serializeToString(svg as Node)
    }
    const outerHTML = (svg as { outerHTML?: unknown }).outerHTML
    if (typeof outerHTML === 'string') return outerHTML
  }
  throw new UserFacingError('Excalidraw SVG export returned invalid SVG.')
}

function excalidrawBasename(file: TFile): string {
  return file.name.replace(/\.excalidraw(?:\.md)?$/i, '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
