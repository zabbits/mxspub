import { MarkdownView, Notice, Plugin } from 'obsidian'

import { AuthService } from './auth'
import { probeEndpoint } from './api'
import { Publisher } from './publisher'
import {
  MxSpacePublisherSettingTab,
  loadPluginSettings,
} from './settings'
import { normalizeApiUrl } from './slug'
import type { MxSpacePublisherSettings } from './types'

export default class MxSpacePublisherPlugin extends Plugin {
  settings!: MxSpacePublisherSettings
  private auth!: AuthService
  private publisher!: Publisher
  private publishActionElements = new Set<HTMLElement>()
  private publishActionViews = new WeakSet<MarkdownView>()

  override async onload(): Promise<void> {
    this.settings = await loadPluginSettings(this)
    this.auth = new AuthService(this.app, this.settings)
    this.publisher = new Publisher(
      this.app,
      this.settings,
      this.auth,
      () => this.ensureEndpointConfigured(),
    )

    this.addSettingTab(new MxSpacePublisherSettingTab(this.app, this))
    this.addRibbonIcon('send', 'Publish with Mxspub', () => {
      void this.publisher.publishCurrentFile()
    })

    this.addCommand({
      id: 'publish-current-file',
      name: 'Publish',
      callback: () => {
        void this.publisher.publishCurrentFile()
      },
    })

    this.addCommand({
      id: 'unpublish-current-file',
      name: 'Unpublish',
      callback: () => {
        void this.publisher.unpublishCurrentFile()
      },
    })

    this.app.workspace.onLayoutReady(() => {
      this.registerMarkdownPublishActions()
    })
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.registerMarkdownPublishActions()
      }),
    )
    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        this.registerMarkdownPublishActions()
      }),
    )
    this.register(() => {
      for (const element of this.publishActionElements) element.detach()
      this.publishActionElements.clear()
    })
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  async ensureEndpointConfigured(): Promise<void> {
    if (this.settings.apiBase && this.settings.authBase) return
    if (!this.settings.apiUrl.trim()) {
      throw new Error('Configure the mx-space API URL in settings first.')
    }

    const endpoint = await probeEndpoint(this.settings.apiUrl)
    this.settings.apiUrl = endpoint.apiUrl
    this.settings.apiBase = endpoint.apiBase
    this.settings.authBase = endpoint.authBase
    await this.saveSettings()
  }

  async testConnection(): Promise<void> {
    try {
      const endpoint = await probeEndpoint(this.settings.apiUrl)
      this.settings.apiUrl = normalizeApiUrl(endpoint.apiUrl)
      this.settings.apiBase = endpoint.apiBase
      this.settings.authBase = endpoint.authBase
      await this.saveSettings()
      new Notice('Mxspub connection OK.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      new Notice(message, 8000)
    }
  }

  async checkApiKey(): Promise<void> {
    try {
      await this.ensureEndpointConfigured()
      await this.auth.checkApiKey()
      new Notice('Mxspub API key OK.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      new Notice(message, 8000)
    }
  }

  private registerMarkdownPublishActions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (!(leaf.view instanceof MarkdownView)) continue
      if (this.publishActionViews.has(leaf.view)) continue

      this.publishActionViews.add(leaf.view)
      const action = leaf.view.addAction('send', 'Publish with Mxspub', () => {
        this.app.workspace.setActiveLeaf(leaf, { focus: true })
        void this.publisher.publishCurrentFile()
      })
      action.addClass('mxspub-publish-view-action')
      this.publishActionElements.add(action)
    }
  }
}

export type { MxSpacePublisherPlugin }
