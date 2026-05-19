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
      }
      this.settings.imageUploadCache[hash] = next
      publishCache.set(hash, next)
      return { cache: next, changed: next.lastUsedAt !== cached.lastUsedAt }
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
  return [
    ...collectMarkdownImages(markdown),
    ...collectWikiImageEmbeds(markdown),
  ].sort((a, b) => a.start - b.start)
}

function collectMarkdownImages(markdown: string): ImageReference[] {
  const references: ImageReference[] = []
  const pattern = /!\[([^\]]*)\]\(([^)]*)\)/g
  for (const match of markdown.matchAll(pattern)) {
    const rawTarget = normalizeMarkdownDestination(match[2])
    if (!rawTarget) continue
    references.push({
      alt: match[1].trim(),
      end: match.index + match[0].length,
      rawTarget,
      start: match.index,
      type: 'markdown',
    })
  }
  return references
}

function collectWikiImageEmbeds(markdown: string): ImageReference[] {
  const references: ImageReference[] = []
  const pattern = /!\[\[([^\]]+)\]\]/g
  for (const match of markdown.matchAll(pattern)) {
    const parts = match[1].split('|').map((part) => part.trim())
    const rawTarget = parts[0]
    if (!rawTarget) continue
    references.push({
      alt: displayTextForWiki(parts[1], rawTarget),
      end: match.index + match[0].length,
      rawTarget,
      start: match.index,
      type: 'wiki',
    })
  }
  return references
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
