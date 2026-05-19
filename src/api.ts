import { requestUrl, type RequestUrlResponse } from 'obsidian'

import { normalizeApiUrl } from './slug'
import type { EndpointConfig, JsonObject, JsonValue } from './types'

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

export class MxSpaceApiClient {
  constructor(private options: ApiClientOptions) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.perform<T>(path, options, true)
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
