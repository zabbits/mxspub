import { App, Notice, TFile } from 'obsidian'

import type { AuthService } from './auth'
import { ensurePublishedBaseFile } from './bases'
import { UserFacingError } from './api'
import {
  getActiveMarkdownFile,
  readMarkdownFileContext,
  showError,
  updateMxPublishMetadata,
  updatePublishFrontmatter,
  withMxType,
} from './frontmatter'
import { confirmAction, pickContentType } from './modals'
import { ImageUploadService } from './images'
import { buildPayload, resolveSlug } from './payload'
import { RelationService } from './relations'
import type {
  ContentType,
  MarkdownFileContext,
  MxNote,
  MxNotePayload,
  MxPage,
  MxPagePayload,
  MxPost,
  MxPostPayload,
  MxSpacePublisherSettings,
  PublishFrontmatter,
  PublishPayload,
  PublishStatusPayload,
  PublishStatusResponse,
} from './types'

type Endpoint = '/posts' | '/notes' | '/pages'

export class Publisher {
  constructor(
    private app: App,
    private settings: MxSpacePublisherSettings,
    private auth: AuthService,
    private ensureEndpoint: () => Promise<void>,
    private saveSettings: () => Promise<void>,
  ) {}

  async publishCurrentFile(): Promise<void> {
    await this.runWithUserErrors(async () => {
      const file = this.requireActiveMarkdownFile()
      let context = await readMarkdownFileContext(this.app, file)
      let type = context.mx.type

      if (!type) {
        const picked = await pickContentType(this.app, this.settings.defaultType)
        if (!picked) return
        type = picked
        context = withMxType(context, type)
      }

      await this.ensureEndpoint()
      if (!this.auth.hasAnyAuth()) {
        throw new UserFacingError('Select an API key secret in settings first.')
      }

      const api = this.auth.createApiClient()
      const imageUploadService = new ImageUploadService(
        this.app,
        this.settings,
        api,
        this.saveSettings,
      )
      context = await imageUploadService.prepareContext(context, file)
      const relationService = new RelationService(api, this.settings)
      if (type === 'post') {
        const typedContext = withMxType(context, 'post')
        const relations = await relationService.resolveForPost(typedContext)
        const isPublished = isPublishedFromMetadata(typedContext.mx.publish)
        await this.publishPreparedFile({
          api,
          context: typedContext,
          file,
          frontmatter: relations.frontmatter,
          payload: buildPayload({
            context: typedContext,
            isPublished,
            relations,
            type: 'post',
          }),
          isPublished,
          type: 'post',
        })
        return
      }

      if (type === 'note') {
        const typedContext = withMxType(context, 'note')
        const relations = await relationService.resolveForNote(typedContext)
        const isPublished = isPublishedFromMetadata(typedContext.mx.publish)
        await this.publishPreparedFile({
          api,
          context: typedContext,
          file,
          frontmatter: relations.frontmatter,
          payload: buildPayload({
            context: typedContext,
            isPublished,
            relations,
            type: 'note',
          }),
          isPublished,
          type: 'note',
        })
        return
      }

      const typedContext = withMxType(context, 'page')
      const relations = await relationService.resolveForPage()
      await this.publishPreparedFile({
        api,
        context: typedContext,
        file,
        frontmatter: relations.frontmatter,
        payload: buildPayload({
          context: typedContext,
          isPublished: true,
          relations,
          type: 'page',
        }),
        isPublished: true,
        type: 'page',
      })
    })
  }

  async unpublishCurrentFile(): Promise<void> {
    await this.runWithUserErrors(async () => {
      const file = this.requireActiveMarkdownFile()
      const context = await readMarkdownFileContext(this.app, file)
      const type = context.mx.type
      const id = context.mx.id

      if (!type) throw new UserFacingError('type is missing.')
      if (type === 'page') {
        throw new UserFacingError('Pages do not support unpublish.')
      }
      if (!id) throw new UserFacingError('remoteId is missing.')

      const confirmed = await confirmAction(
        this.app,
        'Unpublish current file',
        `Mark this remote ${type} as unpublished?`,
      )
      if (!confirmed) return

      await this.ensureEndpoint()
      const api = this.auth.createApiClient()
      const body: PublishStatusPayload = { isPublished: false }
      await api.request<PublishStatusResponse>(`${endpointFor(type)}/${id}/publish`, {
        body,
        method: 'PATCH',
      })

      await updateMxPublishMetadata(this.app, file, {
        publish: false,
      })
      await ensurePublishedBaseFile(this.app)
      new Notice(`${typeLabel(type)} unpublished.`)
    })
  }

  async deleteCurrentFile(): Promise<void> {
    await this.runWithUserErrors(async () => {
      const file = this.requireActiveMarkdownFile()
      const context = await readMarkdownFileContext(this.app, file)
      const type = context.mx.type
      const id = context.mx.id

      if (!type) throw new UserFacingError('type is missing.')
      if (!id) throw new UserFacingError('remoteId is missing.')

      const confirmed = await confirmAction(
        this.app,
        'Delete remote content',
        `Delete this remote ${type}? This cannot be undone.`,
      )
      if (!confirmed) return

      await this.ensureEndpoint()
      const api = this.auth.createApiClient()
      await deleteDocument(api, type, id)

      await updateMxPublishMetadata(this.app, file, {
        id: undefined,
        published: undefined,
        publish: type === 'page' ? undefined : false,
      })
      await ensurePublishedBaseFile(this.app)
      new Notice(`${typeLabel(type)} deleted.`)
    })
  }

  private requireActiveMarkdownFile(): TFile {
    const file = getActiveMarkdownFile(this.app)
    if (!file) throw new UserFacingError('Open a Markdown file first.')
    return file
  }

  private async publishPreparedFile<T extends ContentType>({
    api,
    context,
    file,
    frontmatter,
    payload,
    isPublished,
    type,
  }: {
    api: ReturnType<AuthService['createApiClient']>
    context: MarkdownFileContext<T>
    file: TFile
    frontmatter: Partial<PublishFrontmatter<T>>
    payload: PublishPayload
    isPublished: boolean
    type: T
  }): Promise<void> {
    const existingId = context.mx.id
    const created = existingId
      ? null
      : await createDocument(api, type, payload)
    if (existingId) {
      await patchDocument(api, type, existingId, payload)
    }

    const id = existingId ?? created?.id
    if (!id) throw new UserFacingError('mx-space did not return a document id.')

    const now = new Date().toISOString()
    const slug = documentSlug(created) ?? payload.slug ?? resolveSlug(context)
    const publishFrontmatter: Partial<PublishFrontmatter<T>> = {
      title: context.publish.title ?? context.fileBasename,
      ...frontmatter,
    }
    await updatePublishFrontmatter(this.app, file, {
      mx: {
        id,
        published: context.mx.published ?? now,
        publish: type === 'page' ? undefined : isPublished,
        slug,
        type,
      },
      publish: publishFrontmatter,
    })
    await ensurePublishedBaseFile(this.app)

    new Notice(
      `${typeLabel(type)} ${existingId ? 'updated' : 'published'}: ${slug}`,
    )
  }

  private async runWithUserErrors(task: () => Promise<void>): Promise<void> {
    try {
      await task()
    } catch (error) {
      showError(error instanceof Error ? error : String(error))
    }
  }
}

function endpointFor(type: ContentType): Endpoint {
  if (type === 'post') return '/posts'
  if (type === 'note') return '/notes'
  return '/pages'
}

async function createDocument(
  api: ReturnType<AuthService['createApiClient']>,
  type: ContentType,
  payload: PublishPayload,
): Promise<MxPost | MxNote | MxPage> {
  if (type === 'post') {
    return api.request<MxPost>('/posts', {
      body: payload as MxPostPayload,
      method: 'POST',
    })
  }
  if (type === 'note') {
    return api.request<MxNote>('/notes', {
      body: payload as MxNotePayload,
      method: 'POST',
    })
  }
  return api.request<MxPage>('/pages', {
    body: payload as MxPagePayload,
    method: 'POST',
  })
}

async function patchDocument(
  api: ReturnType<AuthService['createApiClient']>,
  type: ContentType,
  id: string,
  payload: PublishPayload,
): Promise<void> {
  if (type === 'post') {
    await api.request<void>(`/posts/${id}`, {
      body: payload as MxPostPayload,
      method: 'PATCH',
    })
    return
  }
  if (type === 'note') {
    await api.request<void>(`/notes/${id}`, {
      body: payload as MxNotePayload,
      method: 'PATCH',
    })
    return
  }
  await api.request<void>(`/pages/${id}`, {
    body: payload as MxPagePayload,
    method: 'PATCH',
  })
}

async function deleteDocument(
  api: ReturnType<AuthService['createApiClient']>,
  type: ContentType,
  id: string,
): Promise<void> {
  await api.request<void>(`${endpointFor(type)}/${id}`, {
    method: 'DELETE',
  })
}

function documentSlug(document: MxPost | MxNote | MxPage | null): string | undefined {
  if (!document) return
  return typeof document.slug === 'string' && document.slug.trim()
    ? document.slug
    : undefined
}

function typeLabel(type: ContentType): string {
  if (type === 'post') return 'Post'
  if (type === 'note') return 'Note'
  return 'Page'
}

function isPublishedFromMetadata(publish: boolean | undefined): boolean {
  return publish !== false
}
