import type { App } from 'obsidian'

import { MxSpaceApiClient, UserFacingError } from './api'
import { readApiKey } from './secrets'
import type { MxSpacePublisherSettings } from './types'

export class AuthService {
  constructor(
    private app: App,
    private settings: MxSpacePublisherSettings,
  ) {}

  createApiClient(): MxSpaceApiClient {
    return new MxSpaceApiClient({
      apiBase: this.settings.apiBase,
      authProvider: {
        getAuthHeaders: async () => {
          const apiKey = readApiKey(this.app, this.settings.apiKeySecretId)
          const headers: Record<string, string> = {}
          if (apiKey) headers['x-api-key'] = apiKey
          return headers
        },
        refreshAfterUnauthorized: async () => false,
      },
    })
  }

  hasAnyAuth(): boolean {
    return Boolean(readApiKey(this.app, this.settings.apiKeySecretId))
  }

  async checkApiKey(): Promise<void> {
    const apiKey = readApiKey(this.app, this.settings.apiKeySecretId)
    if (!apiKey) {
      throw new UserFacingError('Select an API key secret in settings first.')
    }

    const isValid = await this.createApiClient().request<boolean>('/auth/token', {
      query: { token: apiKey },
    })

    if (isValid !== true) {
      throw new UserFacingError('API key is invalid or expired.')
    }
  }
}
