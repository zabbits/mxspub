import { App, Modal, Setting } from 'obsidian'

import { CONTENT_TYPES } from './types'
import type { ContentType } from './types'

export function pickContentType(
  app: App,
  defaultType: ContentType,
): Promise<ContentType | null> {
  return new Promise((resolve) => {
    new TypePickerModal(app, defaultType, resolve).open()
  })
}

export function confirmAction(
  app: App,
  title: string,
  message: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, title, message, resolve).open()
  })
}

class TypePickerModal extends Modal {
  private resolved = false

  constructor(
    app: App,
    private defaultType: ContentType,
    private resolve: (type: ContentType | null) => void,
  ) {
    super(app)
  }

  override onOpen(): void {
    this.setTitle('Publish as')
    this.contentEl.empty()

    for (const type of CONTENT_TYPES) {
      new Setting(this.contentEl)
        .setName(typeLabel(type))
        .setDesc(type === this.defaultType ? 'Default' : '')
        .addButton((button) =>
          button.setButtonText('Select').onClick(() => {
            this.resolved = true
            this.resolve(type)
            this.close()
          }),
        )
    }
  }

  override onClose(): void {
    if (!this.resolved) this.resolve(null)
    this.contentEl.empty()
  }
}

class ConfirmModal extends Modal {
  private resolved = false

  constructor(
    app: App,
    private title: string,
    private message: string,
    private resolve: (confirmed: boolean) => void,
  ) {
    super(app)
  }

  override onOpen(): void {
    this.setTitle(this.title)
    this.contentEl.empty()
    this.contentEl.createEl('p', { text: this.message })

    const actions = this.contentEl.createDiv({ cls: 'mxspub-modal-actions' })
    new Setting(actions)
      .addButton((button) =>
        button.setButtonText('Cancel').onClick(() => this.finish(false)),
      )
      .addButton((button) =>
        button
          .setButtonText('Confirm')
          .setCta()
          .onClick(() => this.finish(true)),
      )
  }

  override onClose(): void {
    if (!this.resolved) this.resolve(false)
    this.contentEl.empty()
  }

  private finish(value: boolean): void {
    this.resolved = true
    this.resolve(value)
    this.close()
  }
}

function typeLabel(type: ContentType): string {
  if (type === 'post') return 'Post'
  if (type === 'note') return 'Note'
  return 'Page'
}
