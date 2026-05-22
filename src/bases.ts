import { App, TFile, normalizePath } from 'obsidian'

import { MXSPUB_BASE_VIEW_TYPE } from './base-view'

export const MXSPUB_BASE_PATH = 'Mxspub/mxspub-published.base'

const MXSPUB_BASE_CONTENT = `filters:
  and:
    - file.ext == "md"
    - file.hasProperty("remoteId")
formulas:
  local_file: file.asLink()
properties:
  formula.local_file:
    displayName: File
  title:
    displayName: Title
  type:
    displayName: Type
  publish:
    displayName: Publish
  category:
    displayName: Category
  topic:
    displayName: Topic
  remoteId:
    displayName: Remote ID
  slug:
    displayName: Slug
  published:
    displayName: Published
  updated:
    displayName: Updated
  file.folder:
    displayName: Folder
views:
  - type: ${MXSPUB_BASE_VIEW_TYPE}
    name: Mxspub
    order:
      - formula.local_file
      - title
      - type
      - publish
      - category
      - topic
      - slug
      - updated
      - published
      - remoteId
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Overview
    groupBy:
      property: type
      direction: ASC
    order:
      - formula.local_file
      - title
      - type
      - publish
      - category
      - topic
      - slug
      - updated
      - published
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Recent
    order:
      - formula.local_file
      - title
      - type
      - publish
      - slug
      - updated
      - published
      - file.folder
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Posts
    filters:
      and:
        - type == "post"
    groupBy:
      property: publish
      direction: ASC
    order:
      - formula.local_file
      - title
      - category
      - tags
      - type
      - publish
      - slug
      - updated
      - published
      - remoteId
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Notes
    filters:
      and:
        - type == "note"
    groupBy:
      property: publish
      direction: ASC
    order:
      - formula.local_file
      - title
      - topic
      - mood
      - weather
      - type
      - publish
      - slug
      - updated
      - published
      - remoteId
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Pages
    filters:
      and:
        - type == "page"
    order:
      - formula.local_file
      - title
      - subtitle
      - order
      - type
      - slug
      - updated
      - published
      - remoteId
    sort:
      - property: updated
        direction: DESC
`

export async function ensurePublishedBaseFile(app: App): Promise<TFile> {
  const path = normalizePath(MXSPUB_BASE_PATH)
  const folder = path.split('/').slice(0, -1).join('/')
  if (folder && !app.vault.getFolderByPath(folder)) {
    await app.vault.createFolder(folder)
  }

  const existing = app.vault.getFileByPath(path)
  if (existing) {
    const current = await app.vault.cachedRead(existing)
    if (current !== MXSPUB_BASE_CONTENT) {
      await app.vault.modify(existing, MXSPUB_BASE_CONTENT)
    }
    return existing
  }

  return app.vault.create(path, MXSPUB_BASE_CONTENT)
}
