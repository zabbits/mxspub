import { App, TFile, normalizePath } from 'obsidian'

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

interface ImageReference {
  alt: string
  rawTarget: string
  start: number
  end: number
  type: 'markdown' | 'wiki'
}

interface SourceRange {
  start: number
  end: number
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

      const imageFile = resolveImageFile(this.app, reference.rawTarget, file)
      if (!imageFile) {
        throw new UserFacingError(
          `Cannot find image referenced by ${reference.rawTarget}.`,
        )
      }

      const entry = await this.uploadImageFile(imageFile, uploadCache)
      if (entry.changed) cacheChanged = true
      replacements.push({
        end: reference.end,
        start: reference.start,
        value: markdownImage(reference.alt || imageFile.basename, entry.cache.url),
      })
    }

    if (replacements.length === 0) return context
    if (cacheChanged) await this.saveSettings()

    return {
      ...context,
      body: applyReplacements(context.body, replacements),
    }
  }

  private async uploadImageFile(
    file: TFile,
    publishCache: Map<string, ImageUploadCacheEntry>,
  ): Promise<{ cache: ImageUploadCacheEntry; changed: boolean }> {
    const data = await this.app.vault.readBinary(file)
    const hash = `sha256:${await sha256Hex(data)}`
    const now = new Date().toISOString()
    const cached = publishCache.get(hash) ?? this.settings.imageUploadCache[hash]

    if (cached?.url && cached.name) {
      const next: ImageUploadCacheEntry = {
        ...cached,
        lastUsedAt: now,
        sourcePath: file.path,
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
      contentType: mimeTypeForFile(file),
      data,
      filename: file.name,
    })
    const entry: ImageUploadCacheEntry = {
      byteSize: data.byteLength,
      lastUsedAt: now,
      name: response.name,
      sourcePath: file.path,
      uploadedAt: now,
      url: response.url,
    }
    this.settings.imageUploadCache[hash] = entry
    publishCache.set(hash, entry)
    return { cache: entry, changed: true }
  }
}

function collectImageReferences(markdown: string): ImageReference[] {
  const ignoredRanges = collectIgnoredMarkdownRanges(markdown)
  return [
    ...collectMarkdownImages(markdown, ignoredRanges),
    ...collectWikiImageEmbeds(markdown, ignoredRanges),
  ].sort((a, b) => a.start - b.start)
}

export function collectImageReferencesForTest(markdown: string): ImageReference[] {
  return collectImageReferences(markdown)
}

function collectMarkdownImages(
  markdown: string,
  ignoredRanges: SourceRange[],
): ImageReference[] {
  const references: ImageReference[] = []
  let index = 0

  while (index < markdown.length) {
    const start = markdown.indexOf('![', index)
    if (start < 0) break
    if (isIgnoredRange(start, start + 2, ignoredRanges)) {
      index = start + 2
      continue
    }

    const altEnd = findClosingBracket(markdown, start + 2)
    if (altEnd < 0 || markdown[altEnd + 1] !== '(') {
      index = start + 2
      continue
    }

    const destination = parseMarkdownDestination(markdown, altEnd + 1)
    if (!destination) {
      index = start + 2
      continue
    }

    const rawTarget = normalizeMarkdownDestination(destination.value)
    if (!rawTarget) {
      index = destination.end
      continue
    }
    references.push({
      alt: markdown.slice(start + 2, altEnd).replace(/\\]/g, ']').trim(),
      end: destination.end,
      rawTarget,
      start,
      type: 'markdown',
    })
    index = destination.end
  }

  return references
}

function collectWikiImageEmbeds(
  markdown: string,
  ignoredRanges: SourceRange[],
): ImageReference[] {
  const references: ImageReference[] = []
  const pattern = /!\[\[([^\]]+)\]\]/g
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index
    const end = match.index + match[0].length
    if (isIgnoredRange(start, end, ignoredRanges)) continue
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

function collectIgnoredMarkdownRanges(markdown: string): SourceRange[] {
  const ranges = collectBlockCodeRanges(markdown)
  ranges.push(...collectInlineCodeRanges(markdown, ranges))
  return ranges.sort((a, b) => a.start - b.start)
}

function collectBlockCodeRanges(markdown: string): SourceRange[] {
  const ranges: SourceRange[] = []
  let index = 0
  let fence: { marker: string; length: number } | null = null
  let listContentIndent: number | null = null

  while (index < markdown.length) {
    const lineEnd = markdown.indexOf('\n', index)
    const end = lineEnd < 0 ? markdown.length : lineEnd + 1
    const line = markdown.slice(index, lineEnd < 0 ? markdown.length : lineEnd)
    const fenceOpenMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)

    if (fence) {
      ranges.push({ end, start: index })
      if (isClosingFence(line, fence)) fence = null
    } else if (fenceOpenMatch) {
      const run = fenceOpenMatch[1]
      fence = { length: run.length, marker: run[0] }
      ranges.push({ end, start: index })
    } else if (isIndentedCodeLine(line, listContentIndent)) {
      ranges.push({ end, start: index })
    }

    listContentIndent = nextListContentIndent(line, listContentIndent)
    index = end
  }

  return ranges
}

function isClosingFence(
  line: string,
  fence: { marker: string; length: number },
): boolean {
  const escapedMarker = fence.marker === '`' ? '`' : '~'
  const pattern = new RegExp(`^ {0,3}${escapedMarker}{${fence.length},}[ \\t]*$`)
  return pattern.test(line)
}

function isIndentedCodeLine(
  line: string,
  listContentIndent: number | null,
): boolean {
  if (!/^(?: {4}|\t)/.test(line)) return false
  const indent = lineIndent(line)
  if (listContentIndent === null) return true
  return indent >= listContentIndent + 4
}

function nextListContentIndent(
  line: string,
  current: number | null,
): number | null {
  if (!line.trim()) return current

  const match = line.match(/^(\s{0,3})(?:[-+*]|\d+[.)])(\s+)/)
  if (match?.index === 0) {
    return match[0].length
  }

  if (current !== null && lineIndent(line) >= current) return current
  return null
}

function lineIndent(line: string): number {
  let indent = 0
  for (const char of line) {
    if (char === ' ') {
      indent++
      continue
    }
    if (char === '\t') {
      indent += 4
      continue
    }
    break
  }
  return indent
}

function collectInlineCodeRanges(
  markdown: string,
  blockRanges: SourceRange[],
): SourceRange[] {
  const ranges: SourceRange[] = []
  let index = 0

  while (index < markdown.length) {
    const start = markdown.indexOf('`', index)
    if (start < 0) break
    if (isIgnoredRange(start, start + 1, blockRanges)) {
      index = start + 1
      continue
    }

    const ticks = countRun(markdown, start, '`')
    let cursor = start + ticks
    let end = -1
    while (cursor < markdown.length) {
      const next = markdown.indexOf('`', cursor)
      if (next < 0) break
      if (isIgnoredRange(next, next + 1, blockRanges)) {
        cursor = next + 1
        continue
      }
      const nextTicks = countRun(markdown, next, '`')
      if (nextTicks === ticks) {
        end = next + nextTicks
        break
      }
      cursor = next + nextTicks
    }

    if (end < 0) {
      index = start + ticks
      continue
    }
    ranges.push({ end, start })
    index = end
  }

  return ranges
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

function countRun(source: string, start: number, char: string): number {
  let count = 0
  while (source[start + count] === char) count++
  return count
}

function isIgnoredRange(
  start: number,
  end: number,
  ranges: SourceRange[],
): boolean {
  return ranges.some((range) => start < range.end && end > range.start)
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

function resolveImageFile(app: App, rawTarget: string, sourceFile: TFile): TFile | null {
  const target = stripSubpath(decodeTarget(rawTarget))
  const candidates = new Set<string>([target, rawTarget, stripSubpath(rawTarget)])
  const sourceDir = sourceFile.parent?.path ?? ''
  if (sourceDir) {
    candidates.add(normalizePath(`${sourceDir}/${target}`))
    candidates.add(normalizePath(`${sourceDir}/${rawTarget}`))
  }

  for (const candidate of candidates) {
    const linked = app.metadataCache.getFirstLinkpathDest(candidate, sourceFile.path)
    if (linked && isImageFile(linked)) return linked
    const direct = app.vault.getFileByPath(normalizePath(candidate))
    if (direct && isImageFile(direct)) return direct
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
