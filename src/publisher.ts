import { App, Notice, TFile } from 'obsidian'

import type { AuthService } from './auth'
import { UserFacingError } from './api'
import {
  getActiveMarkdownFile,
  readMarkdownFileContext,
  showError,
  updateMxspaceFrontmatter,
  updatePublishFrontmatter,
  withMxspaceType,
} from './frontmatter'
import { confirmAction, pickContentType } from './modals'
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
  PublishState,
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
  ) {}

  async publishCurrentFile(): Promise<void> {
    await this.runWithUserErrors(async () => {
      const file = this.requireActiveMarkdownFile()
      let context = await readMarkdownFileContext(this.app, file)
      let type = context.mxspace.type

      if (!type) {
        const picked = await pickContentType(this.app, this.settings.defaultType)
        if (!picked) return
        type = picked
        context = withMxspaceType(context, type)
      }

      await this.ensureEndpoint()
      if (!this.auth.hasAnyAuth()) {
        throw new UserFacingError('Select an API key secret in settings first.')
      }

      const api = this.auth.createApiClient()
      const relationService = new RelationService(api, this.settings)
      if (type === 'post') {
        const typedContext = withMxspaceType(context, 'post')
        const relations = await relationService.resolveForPost(typedContext)
        const state = typedContext.mxspace.state ?? this.settings.defaultState
        await this.publishPreparedFile({
          api,
          context: typedContext,
          file,
          frontmatter: relations.frontmatter,
          payload: buildPayload({
            context: typedContext,
            relations,
            state,
            type: 'post',
          }),
          state,
          type: 'post',
        })
        return
      }

      if (type === 'note') {
        const typedContext = withMxspaceType(context, 'note')
        const relations = await relationService.resolveForNote(typedContext)
        const state = typedContext.mxspace.state ?? this.settings.defaultState
        await this.publishPreparedFile({
          api,
          context: typedContext,
          file,
          frontmatter: relations.frontmatter,
          payload: buildPayload({
            context: typedContext,
            relations,
            state,
            type: 'note',
          }),
          state,
          type: 'note',
        })
        return
      }

      const typedContext = withMxspaceType(context, 'page')
      const relations = await relationService.resolveForPage()
      const state = typedContext.mxspace.state ?? this.settings.defaultState
      await this.publishPreparedFile({
        api,
        context: typedContext,
        file,
        frontmatter: relations.frontmatter,
        payload: buildPayload({
          context: typedContext,
          relations,
          state,
          type: 'page',
        }),
        state,
        type: 'page',
      })
    })
  }

  async unpublishCurrentFile(): Promise<void> {
    await this.runWithUserErrors(async () => {
      const file = this.requireActiveMarkdownFile()
      const context = await readMarkdownFileContext(this.app, file)
      const type = context.mxspace.type
      const id = context.mxspace.id

      if (!type) throw new UserFacingError('mxspace.type is missing.')
      if (type === 'page') {
        throw new UserFacingError('Pages do not support unpublish.')
      }
      if (!id) throw new UserFacingError('mxspace.id is missing.')

      const confirmed = await confirmAction(
        this.app,
        'Unpublish current file',
        `Set this remote ${type} to draft?`,
      )
      if (!confirmed) return

      await this.ensureEndpoint()
      const api = this.auth.createApiClient()
      const body: PublishStatusPayload = { isPublished: false }
      await api.request<PublishStatusResponse>(`${endpointFor(type)}/${id}/publish`, {
        body,
        method: 'PATCH',
      })

      await updateMxspaceFrontmatter(this.app, file, {
        state: 'draft',
      })
      new Notice(`${typeLabel(type)} unpublished.`)
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
    state,
    type,
  }: {
    api: ReturnType<AuthService['createApiClient']>
    context: MarkdownFileContext<T>
    file: TFile
    frontmatter: Partial<PublishFrontmatter<T>>
    payload: PublishPayload
    state: PublishState
    type: T
  }): Promise<void> {
    const existingId = context.mxspace.id
    const created = existingId
      ? null
      : await createDocument(api, type, payload)
    if (existingId) {
      await patchDocument(api, type, existingId, payload)
    }

    const id = existingId ?? created?.id
    if (!id) throw new UserFacingError('mx-space did not return a document id.')

    const slug = documentSlug(created) ?? payload.slug ?? resolveSlug(context)
    await updatePublishFrontmatter(this.app, file, {
      mxspace: {
        id,
        lastPublishedAt: new Date().toISOString(),
        slug,
        state: type === 'page' ? context.mxspace.state : state,
        type,
      },
      publish: frontmatter,
    })

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
