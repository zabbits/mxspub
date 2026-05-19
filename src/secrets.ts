import type { App } from 'obsidian'

export function readApiKey(app: App, secretId: string): string | null {
  if (!secretId.trim()) return null
  return app.secretStorage.getSecret(secretId.trim()) || null
}
