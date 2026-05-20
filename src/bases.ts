import { App, TFile, normalizePath } from 'obsidian'

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
  mxType:
    displayName: Type
  mxState:
    displayName: State
  mxRemoteId:
    displayName: Remote ID
  slug:
    displayName: Slug
  mxPublishedAt:
    displayName: Published
  updated:
    displayName: Updated
views:
  - type: table
    name: All
    order:
      - formula.local_file
      - mxType
      - mxState
      - mxRemoteId
      - slug
      - mxPublishedAt
      - updated
    sort:
      - property: updated
        direction: DESC
  - type: table
    name: Articles
    filters:
      and:
        - mxType == "post"
    order:
      - formula.local_file
      - mxType
      - mxState
      - mxRemoteId
      - slug
      - mxPublishedAt
      - updated
  - type: table
    name: Notes
    filters:
      and:
        - mxType == "note"
    order:
      - formula.local_file
      - mxType
      - mxState
      - mxRemoteId
      - slug
      - mxPublishedAt
      - updated
  - type: table
    name: Pages
    filters:
      and:
        - mxType == "page"
    order:
      - formula.local_file
      - mxType
      - mxState
      - mxRemoteId
      - slug
      - mxPublishedAt
      - updated
  - type: table
    name: Published
    filters:
      and:
        - mxState == "publish"
    order:
      - formula.local_file
      - mxType
      - mxState
      - mxRemoteId
      - slug
      - mxPublishedAt
      - updated
  - type: table
    name: Draft
    filters:
      and:
        - mxState == "draft"
    order:
      - formula.local_file
      - mxType
      - mxState
      - mxRemoteId
      - slug
      - mxPublishedAt
      - updated
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
