import {
  App,
  PluginSettingTab,
  SecretComponent,
  Setting,
  setIcon,
} from 'obsidian'

import type { MxSpacePublisherPlugin } from './main'
import { CONTENT_TYPES, DEFAULT_SETTINGS, PUBLISH_STATES } from './types'
import type { ContentType, MxSpacePublisherSettings, PublishState } from './types'

export async function loadPluginSettings(
  plugin: MxSpacePublisherPlugin,
): Promise<MxSpacePublisherSettings> {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...((await plugin.loadData()) as Partial<MxSpacePublisherSettings> | null),
  }
  if (
    !settings.imageUploadCache ||
    typeof settings.imageUploadCache !== 'object' ||
    Array.isArray(settings.imageUploadCache)
  ) {
    settings.imageUploadCache = {}
  }
  return settings
}

export class MxSpacePublisherSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: MxSpacePublisherPlugin,
  ) {
    super(app, plugin)
  }

  override display(): void {
    const { containerEl } = this
    containerEl.empty()
    containerEl.createEl('h2', { text: 'Mxspub' })

    new Setting(containerEl)
      .setName('API URL')
      .addText((text) =>
        text
          .setPlaceholder('https://blog.example.com')
          .setValue(this.plugin.settings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiUrl = value.trim()
            this.plugin.settings.apiBase = ''
            this.plugin.settings.authBase = ''
            await this.plugin.saveSettings()
          }),
      )
      .addButton((button) =>
        button
          .setIcon('send')
          .setTooltip('Test connection')
          .onClick(async () => {
            await this.plugin.testConnection()
          }),
      )

    new Setting(containerEl)
      .setName('API key secret')
      .addComponent((host) => {
        const component = new SecretComponent(this.app, host)
          .setValue(this.plugin.settings.apiKeySecretId)
          .onChange(async (value) => {
            this.plugin.settings.apiKeySecretId = value.trim()
            await this.plugin.saveSettings()
          })
        iconizeButtonsByText(host, {
          change: { icon: 'pencil', label: 'Change API key secret' },
        })
        return component
      })
      .addButton((button) =>
        button
          .setIcon('send')
          .setTooltip('Check API key')
          .onClick(async () => {
            await this.plugin.checkApiKey()
          }),
      )

    new Setting(containerEl)
      .setName('Default content type')
      .addDropdown((dropdown) => {
        for (const type of CONTENT_TYPES) dropdown.addOption(type, type)
        dropdown
          .setValue(this.plugin.settings.defaultType)
          .onChange(async (value) => {
            this.plugin.settings.defaultType = value as ContentType
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName('Default publish state')
      .addDropdown((dropdown) => {
        for (const state of PUBLISH_STATES) dropdown.addOption(state, state)
        dropdown
          .setValue(this.plugin.settings.defaultState)
          .onChange(async (value) => {
            this.plugin.settings.defaultState = value as PublishState
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName('Default post category')
      .setDesc('Used when top-level category is missing')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.defaultPostCategory)
          .onChange(async (value) => {
            this.plugin.settings.defaultPostCategory =
              value.trim() || DEFAULT_SETTINGS.defaultPostCategory
            await this.plugin.saveSettings()
          }),
      )

  }
}

function iconizeButtonsByText(
  containerEl: HTMLElement,
  icons: Record<string, { icon: string; label: string }>,
): void {
  for (const buttonEl of containerEl.querySelectorAll('button')) {
    const key = buttonEl.textContent?.trim().toLowerCase()
    if (!key) continue
    const icon = icons[key]
    if (!icon) continue
    buttonEl.empty()
    buttonEl.setAttr('aria-label', icon.label)
    buttonEl.setAttr('title', icon.label)
    setIcon(buttonEl, icon.icon)
  }
}
