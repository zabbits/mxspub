import { requestUrl, type RequestUrlResponse } from 'obsidian'

import { normalizeApiUrl } from './slug'
import type {
  EndpointConfig,
  FileUploadResponse,
  JsonObject,
  JsonValue,
} from './types'

type ApiResponseBody = JsonValue | undefined

export class UserFacingError extends Error {
  readonly status?: number
  readonly body?: ApiResponseBody

  constructor(
    message: string,
    options: { status?: number; body?: ApiResponseBody } = {},
  ) {
    super(message)
    this.name = 'UserFacingError'
    this.status = options.status
    this.body = options.body
  }
}

export interface AuthHeaderProvider {
  getAuthHeaders(): Promise<Record<string, string>>
  refreshAfterUnauthorized(): Promise<boolean>
}

export interface ApiClientOptions {
  apiBase: string
  authProvider?: AuthHeaderProvider
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: JsonValue
  query?: Record<string, string | number | boolean | undefined | null>
  headers?: Record<string, string>
}

interface OrphanListResponse extends JsonObject {
  data?: JsonValue[]
}

interface BatchDeleteResponse extends JsonObject {
  deletedCount?: number
}

export class MxSpaceApiClient {
  constructor(private options: ApiClientOptions) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.perform<T>(path, options, true)
  }

  async uploadImage(file: {
    data: ArrayBuffer
    filename: string
    contentType: string
  }): Promise<FileUploadResponse> {
    const boundary = `----mxspub-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}`
    const body = multipartBody({
      boundary,
      contentType: file.contentType,
      data: file.data,
      fieldName: 'file',
      filename: file.filename,
    })
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': `multipart/form-data; boundary=${boundary}`,
    }
    Object.assign(headers, await this.options.authProvider?.getAuthHeaders())

    const response = await requestUrl({
      body,
      headers,
      method: 'POST',
      throw: false,
      url: buildUrl(this.options.apiBase, '/objects/upload', { type: 'image' }),
    })

    const responseBody = parseResponseBody(response)
    if (response.status >= 200 && response.status < 300) {
      if (
        isJsonObject(responseBody) &&
        typeof responseBody.url === 'string' &&
        typeof responseBody.name === 'string'
      ) {
        return { name: responseBody.name, url: responseBody.url }
      }
      throw new UserFacingError('mx-space upload response is invalid.', {
        body: responseBody,
        status: response.status,
      })
    }

    throw new UserFacingError(messageForStatus(response.status, responseBody), {
      body: responseBody,
      status: response.status,
    })
  }

  async deleteImage(file: { name: string; url: string }): Promise<void> {
    const target = objectImageDeleteTarget(file.url, this.options.apiBase)
    if (target) {
      await this.request<void>(`/objects/image/${encodePathSegment(target)}`, {
        method: 'DELETE',
      })
      return
    }

    const orphanId = await this.findOrphanIdByUrl(file.url)
    if (!orphanId) {
      throw new UserFacingError(
        'Cannot find a mx-space object record for this image.',
      )
    }

    const response = await this.request<BatchDeleteResponse>('/objects/orphans/batch', {
      body: { ids: [orphanId] },
      method: 'DELETE',
    })
    if (typeof response.deletedCount === 'number' && response.deletedCount < 1) {
      throw new UserFacingError('mx-space did not delete the remote image.')
    }
  }

  private async perform<T>(
    path: string,
    options: RequestOptions,
    canRetry: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(options.headers ?? {}),
    }

    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
    }

    const authHeaders = await this.options.authProvider?.getAuthHeaders()
    Object.assign(headers, authHeaders)

    const response = await requestUrl({
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method: options.method ?? 'GET',
      throw: false,
      url: buildUrl(this.options.apiBase, path, options.query),
    })

    if (
      response.status === 401 &&
      canRetry &&
      (await this.options.authProvider?.refreshAfterUnauthorized())
    ) {
      return this.perform<T>(path, options, false)
    }

    const body = parseResponseBody(response)
    if (response.status >= 200 && response.status < 300) return body as T

    throw new UserFacingError(messageForStatus(response.status, body), {
      body,
      status: response.status,
    })
  }

  private async findOrphanIdByUrl(url: string): Promise<string | null> {
    const response = await this.request<OrphanListResponse>('/objects/orphans/list', {
      query: { page: 1, size: 500 },
    })
    const rows = Array.isArray(response.data) ? response.data : []
    for (const row of rows) {
      if (!isJsonObject(row)) continue
      if (row.fileUrl === url && typeof row.id === 'string') return row.id
    }
    return null
  }
}

export function objectImageDeleteTargetForTest(
  imageUrl: string,
  apiBase: string,
): string | null {
  return objectImageDeleteTarget(imageUrl, apiBase)
}

export async function probeEndpoint(apiUrlInput: string): Promise<EndpointConfig> {
  const apiUrl = normalizeApiUrl(apiUrlInput)
  if (!apiUrl) throw new UserFacingError('API URL is required')

  const candidates = [
    { apiBase: `${apiUrl}/api/v2`, authBase: `${apiUrl}/api/v2/auth` },
    { apiBase: apiUrl, authBase: `${apiUrl}/auth` },
  ]

  for (const candidate of candidates) {
    const response = await requestUrl({
      method: 'GET',
      throw: false,
      url: `${candidate.authBase}/ok`,
    }).catch(() => null)

    if (response?.status && response.status >= 200 && response.status < 300) {
      return { apiUrl, ...candidate }
    }
  }

  throw new UserFacingError(
    'Cannot find mx-space auth endpoint. Check the API URL.',
  )
}

function buildUrl(
  apiBase: string,
  path: string,
  query?: RequestOptions['query'],
): string {
  const url = new URL(
    path.startsWith('/') ? path.slice(1) : path,
    apiBase.endsWith('/') ? apiBase : `${apiBase}/`,
  )

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue
    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

function objectImageDeleteTarget(imageUrl: string, apiBase: string): string | null {
  let url: URL
  let base: URL
  try {
    url = new URL(imageUrl)
    base = new URL(apiBase)
  } catch {
    return null
  }

  if (url.origin !== base.origin) return null
  const match = url.pathname.match(/\/objects\/image\/(.+)$/)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

function parseResponseBody(response: RequestUrlResponse): ApiResponseBody {
  if (!response.text || response.text.trim().length === 0) return undefined
  try {
    return JSON.parse(response.text) as JsonValue
  } catch {
    return response.text
  }
}

function messageForStatus(status: number, body: ApiResponseBody): string {
  const message = extractMessage(body)
  if (message) return message
  if (status === 401) return 'Authentication failed. Log in again.'
  if (status === 403) return 'Permission denied by mx-space.'
  if (status === 404) return 'Remote mx-space content was not found.'
  if (status >= 500) return 'mx-space server returned an error.'
  return `mx-space request failed (${status}).`
}

function extractMessage(body: ApiResponseBody): string | null {
  if (!isJsonObject(body)) return null
  const message = body.message
  if (typeof message === 'string') return message
  if (isStringArray(message)) return message.join('; ')
  return null
}

function isJsonObject(value: ApiResponseBody): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function multipartBody(input: {
  boundary: string
  contentType: string
  data: ArrayBuffer
  fieldName: string
  filename: string
}): ArrayBuffer {
  const encoder = new TextEncoder()
  const header = encoder.encode(
    `--${input.boundary}\r\n` +
      `Content-Disposition: form-data; name="${input.fieldName}"; filename="${escapeHeaderValue(
        input.filename,
      )}"\r\n` +
      `Content-Type: ${input.contentType}\r\n\r\n`,
  )
  const footer = encoder.encode(`\r\n--${input.boundary}--\r\n`)
  const body = new Uint8Array(
    header.byteLength + input.data.byteLength + footer.byteLength,
  )
  body.set(header, 0)
  body.set(new Uint8Array(input.data), header.byteLength)
  body.set(footer, header.byteLength + input.data.byteLength)
  return body.buffer
}

function escapeHeaderValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
