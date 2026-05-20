import { App, TFile, normalizePath } from 'obsidian'

import { MXSPUB_BASE_VIEW_TYPE } from './base-view'

export const MXSPUB_BASE_PATH = 'Mxspub/mxspub-published.base'

const MXSPUB_BASE_CONTENT = `filters:
  and:
    - file.ext == "md"
    - file.hasProperty("mxRemoteId")
formulas:
  local_file: file.asLink()
properties:
  formula.local_file:
    displayName: File
  title:
    displayName: Title
  mxType:
    displayName: Type
  mxState:
    displayName: State
  category:
    displayName: Category
  topic:
    displayName: Topic
  mxRemoteId:
    displayName: Remote ID
  slug:
    displayName: Slug
  mxPublishedAt:
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
      - mxType
      - mxState
      - category
      - topic
      - slug
      - updated
      - mxPublishedAt
      - mxRemoteId
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Overview
    groupBy:
      property: mxType
      direction: ASC
    order:
      - formula.local_file
      - title
      - mxType
      - mxState
      - category
      - topic
      - slug
      - updated
      - mxPublishedAt
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Recent
    order:
      - formula.local_file
      - title
      - mxType
      - mxState
      - slug
      - updated
      - mxPublishedAt
      - file.folder
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Posts
    filters:
      and:
        - mxType == "post"
    groupBy:
      property: mxState
      direction: ASC
    order:
      - formula.local_file
      - title
      - category
      - tags
      - mxType
      - mxState
      - slug
      - updated
      - mxPublishedAt
      - mxRemoteId
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Notes
    filters:
      and:
        - mxType == "note"
    groupBy:
      property: mxState
      direction: ASC
    order:
      - formula.local_file
      - title
      - topic
      - mood
      - weather
      - mxType
      - mxState
      - slug
      - updated
      - mxPublishedAt
      - mxRemoteId
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Pages
    filters:
      and:
        - mxType == "page"
    order:
      - formula.local_file
      - title
      - subtitle
      - order
      - mxType
      - slug
      - updated
      - mxPublishedAt
      - mxRemoteId
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Published
    filters:
      and:
        - mxState == "publish"
    order:
      - formula.local_file
      - title
      - mxType
      - mxState
      - category
      - topic
      - slug
      - updated
      - mxPublishedAt
    sort:
      - property: mxPublishedAt
        direction: DESC
  - type: table
    name: Draft
    filters:
      and:
        - mxState == "draft"
    order:
      - formula.local_file
      - title
      - mxType
      - mxState
      - category
      - topic
      - slug
      - updated
      - mxRemoteId
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
