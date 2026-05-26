import { MarkdownView, Notice, Plugin } from 'obsidian'

import { AuthService } from './auth'
import { probeEndpoint } from './api'
import {
  createMxspubBaseViewRegistration,
  MXSPUB_BASE_VIEW_TYPE,
} from './base-view'
import {
  type ManagementTab,
  MXSPUB_MANAGEMENT_VIEW,
  MxspubManagementView,
} from './management'
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
  private deleteActionElements = new Set<HTMLElement>()
  private deleteActionViews = new WeakSet<MarkdownView>()

  override async onload(): Promise<void> {
    this.settings = await loadPluginSettings(this)
    this.auth = new AuthService(this.app, this.settings)
    this.publisher = new Publisher(
      this.app,
      this.settings,
      this.auth,
      () => this.ensureEndpointConfigured(),
      () => this.saveSettings(),
    )

    this.registerView(
      MXSPUB_MANAGEMENT_VIEW,
      (leaf) =>
        new MxspubManagementView(
          leaf,
          this.settings,
          this.auth,
          () => this.ensureEndpointConfigured(),
          () => this.saveSettings(),
        ),
    )
    this.registerBasesView(
      MXSPUB_BASE_VIEW_TYPE,
      createMxspubBaseViewRegistration(),
    )
    this.addSettingTab(new MxSpacePublisherSettingTab(this.app, this))
    this.addRibbonIcon('image', 'Open Mxspub image management', () => {
      void this.openManagementView('images')
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

    this.addCommand({
      id: 'delete-current-file',
      name: 'Delete',
      callback: () => {
        void this.publisher.deleteCurrentFile()
      },
    })

    this.addCommand({
      id: 'open-management',
      name: 'Open management',
      callback: () => {
        void this.openManagementView()
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
      for (const element of this.deleteActionElements) element.detach()
      this.deleteActionElements.clear()
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

  async openManagementView(tab: ManagementTab = 'images'): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MXSPUB_MANAGEMENT_VIEW)
    if (existing.length > 0) {
      const leaf = existing[0]
      if (leaf.view instanceof MxspubManagementView) {
        await leaf.view.openTab(tab)
      }
      await this.app.workspace.revealLeaf(leaf)
      return
    }

    const leaf = this.app.workspace.getLeaf('tab')
    await leaf.setViewState({ active: true, type: MXSPUB_MANAGEMENT_VIEW })
    if (leaf.view instanceof MxspubManagementView) {
      await leaf.view.openTab(tab)
    }
    await this.app.workspace.revealLeaf(leaf)
  }

  private registerMarkdownPublishActions(): void {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (!(leaf.view instanceof MarkdownView)) continue

      if (!this.deleteActionViews.has(leaf.view)) {
        this.deleteActionViews.add(leaf.view)
        const deleteAction = leaf.view.addAction(
          'trash-2',
          'Delete with Mxspub',
          () => {
            this.app.workspace.setActiveLeaf(leaf, { focus: true })
            void this.publisher.deleteCurrentFile()
          },
        )
        deleteAction.addClass('mxspub-delete-view-action')
        this.deleteActionElements.add(deleteAction)
      }

      if (!this.publishActionViews.has(leaf.view)) {
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
}

export type { MxSpacePublisherPlugin }
