# Mxspub Implementation Contract

## Goal

`Mxspub` is an independent Obsidian plugin for publishing Markdown notes to
mx-space content. It does not modify `mx-core`, does not install the `mxs`
binary, and does not execute CLI commands.

The code follows the shape of `mx-core/packages/cli` where useful: endpoint
probing, Markdown payload construction, relation resolution, and content
publishing. It intentionally does not copy the CLI's terminal UX, local config
files, stdout/stderr output model, or error codes.

## User Workflow

- The primary command is `Mxspub: Publish`.
- The companion command is `Mxspub: Unpublish`.
- `Mxspub: Open management` opens a tabbed management view for cached images;
  clicking `Published` directly opens the published-content Base.
- The plugin determines the target content type from `type` in the
  current file's frontmatter.
- If `type` is missing, the plugin opens a type picker and writes the
  selected type back as part of the successful publish result.
- If `remoteId` exists, publish updates the remote document.
- If `remoteId` is missing, publish creates a remote document.
- Local Obsidian image links are uploaded and rewritten in the outgoing payload
  before the remote document is created or updated.
- `publish` controls whether posts and notes are published. Pages do not
  write `publish`.
- `Mxspub: Unpublish` explicitly sets the remote post/note publish status to
  false. Pages do not support unpublish.

## Settings

- `apiUrl`: mx-core origin, for example `https://blog.example.com`.
- `apiKeySecretId`: optional Obsidian SecretStorage id for an `x-api-key`
  credential.
- `defaultType`: fallback content type when a file has no `type`.
- `defaultState`: fallback publish state for posts and notes.
- `defaultPostCategory`: category used when a post has no top-level
  `category`.
- `apiBase` and `authBase`: probed endpoint bases cached after connection
  discovery.
- `imageUploadCache`: SHA-256 image hash to uploaded mx-space URL cache.

## Frontmatter Contract

Publish metadata lives in flat frontmatter fields:

```yaml
title: "Example"
created: "2026-05-01T09:00:00.000Z"
updated: "2026-05-18T12:00:00.000Z"
slug: "example"
type: post
publish: true
remoteId: "1234567890"
published: "2026-05-18T12:00:00.000Z"
```

Post-specific fields live at the top level:

```yaml
title: "Example"
created: "2026-05-01T09:00:00.000Z"
updated: "2026-05-18T12:00:00.000Z"
slug: example
type: post
publish: true
category: "tech"
tags: ["cli", "obsidian"]
summary: "Summary"
```

Note-specific fields live at the top level:

```yaml
title: "Daily note"
created: "2026-05-01T09:00:00.000Z"
updated: "2026-05-18T12:00:00.000Z"
slug: daily-note
type: note
publish: false
topic: "daily"
mood: "calm"
weather: "sunny"
publicAt: "2026-05-18T12:00:00.000Z"
location: "Singapore"
```

Page-specific fields live at the top level:

```yaml
title: "About"
created: "2026-05-01T09:00:00.000Z"
updated: "2026-05-18T12:00:00.000Z"
slug: about
type: page
subtitle: "About this site"
order: 10
```

Rules:

- `type` is `post`, `note`, or `page`.
- `publish` is `true` or `false`; it only applies to posts and notes.
- `title` priority is top-level `title`, then file basename. If `title` is
  absent, successful publish writes the file basename back to top-level
  `title`.
- Top-level `created` controls the remote content `createdAt` value for posts
  and notes. If `created` is absent, the server chooses the creation time on
  create and leaves it unchanged on update. Top-level `createdAt` is accepted as
  a read alias but the plugin writes `created` when it needs to persist a value.
- Top-level `updated` is user-maintained local metadata. The plugin reads it
  for display but does not write it during publish or send it as an API payload
  field.
- Top-level `slug` is user-editable and is sent on every create/update. If it
  is absent, the plugin generates one from the file basename and writes it back.
- Posts require a category. If top-level `category` is missing, the plugin uses
  the settings default post category and auto-creates it when needed.
- Post `category` and note `topic` can be an id, slug, or name.
- Missing categories and topics are created automatically.
- Post `tags` are normalized to `tags: string[]`; they are not created through
  the category API because mx-core exposes tags as post metadata/aggregates
  rather than editable tag records.
- Publishing success writes back `title`, `type`, `remoteId`, `slug`, and
  `published`. Posts and notes also write `publish`.
- Frontmatter writes keep known fields ordered as `title`, then type-specific
  fields, then `created`, `updated`, `slug`, `type`, `publish`, `remoteId`,
  and `published`. Unknown fields are preserved after known
  fields.
- Creates prefer the server-returned slug when mx-space normalizes or uniquifies
  the requested slug.
- Auto-created or resolved relations are normalized back into top-level
  frontmatter (`category`, `tags`, or `topic`).

TypeScript mirrors this contract with separate `PostPublishFrontmatter`,
`NotePublishFrontmatter`, and `PagePublishFrontmatter` types.

## API Behavior

Endpoint probing:

- Probe `${apiUrl}/api/v2/auth/ok`.
- If that fails, probe `${apiUrl}/auth/ok`.
- Cache the working API/auth bases in plugin settings.

Authentication:

- API key requests send the selected secret as `x-api-key`.
- API key checks call `GET /auth/token?token=<key>` with the same `x-api-key`
  header and require the response to be `true`.

Content:

- Post create: `POST /posts`
- Post update: `PATCH /posts/:id`
- Post unpublish: `PATCH /posts/:id/publish` with `{ "isPublished": false }`
- Note create: `POST /notes`
- Note update: `PATCH /notes/:id`
- Note unpublish: `PATCH /notes/:id/publish` with `{ "isPublished": false }`
- Page create: `POST /pages`
- Page update: `PATCH /pages/:id`

Relations:

- Category list: `GET /categories`
- Category create: `POST /categories` with `{ name, slug, type: 0 }`
- Tags: sent directly in post payload `tags: string[]`
- Topic list: `GET /topics/all`
- Topic create: `POST /topics` with `{ name, slug }`

Content payloads:

- All body content is sent as Markdown.
- Local Obsidian image links are replaced with uploaded mx-space URLs in the
  outgoing payload only; the local Markdown file is not modified.
- `contentFormat` is always `markdown`.
- `text` is the Markdown body and remains the rendering/search source.
- `content` is a valid Lexical editor-state JSON snapshot generated from the
  Markdown body, so mx-core front-end editors that parse `content` directly can
  open plugin-published documents without throwing JSON parse errors.
- Top-level frontmatter `created` is sent as API payload `created`.
- Top-level frontmatter `slug` is sent as API payload `slug`.
- Top-level frontmatter `updated` is user-maintained local metadata and is not
  sent.
- API calls use concrete TypeScript response models derived from mx-core
  controller/schema/types: `MxPost`, `MxNote`, `MxPage`, `MxCategory`,
  `MxTopic`, list wrappers, and publish status responses.

## Implementation Files

- `src/main.ts`: plugin entry and commands.
- `src/settings.ts`: settings tab and persisted settings.
- `src/secrets.ts`: SecretStorage helpers for API keys.
- `src/auth.ts`: API key auth headers.
- `src/api.ts`: requestUrl-based HTTP client and endpoint probing.
- `src/base-view.ts`: custom Obsidian Bases view for published content.
- `src/payload.ts`: Markdown payload builders.
- `src/relations.ts`: category/topic resolution/creation and tag normalization.
- `src/frontmatter.ts`: active file extraction and publish metadata updates.
- `src/bases.ts`: generated Obsidian Base file for published content.
- `src/images.ts`: Obsidian image link resolution, upload, payload rewriting,
  and content-hash cache.
- `src/management.ts`: tabbed management view for image cache and Base entry.
- `src/publisher.ts`: publish/update/unpublish orchestration.
- `src/modals.ts`: type picker and confirmation modal.
- `src/types.ts`: shared internal types.
- `src/lexical.ts`: Markdown-to-Lexical snapshot generation.
- `src/slug.ts`: slug generation.
- `styles.css`: plugin UI styles.

## Error Handling

- Missing API URL opens settings and prompts the user to configure it.
- Missing API key prompts the user to select an API key secret.
- Authentication failure prompts the user to check or replace the API key.
- Missing local images stop publish and name the unresolved link.
- Image upload failures stop publish before creating or updating remote content.
- Missing remote content asks the user to clear `remoteId` and republish.
- Relation creation failure stops the publish and names the failing relation.
- Server validation errors show the server message when available.
- Network errors show the API URL and failed stage.

Errors are optimized for Obsidian user feedback, not CLI error-code parity.

## Acceptance Tests

- `pnpm build` succeeds.
- Publishing a new post with a missing category creates the category.
- Publishing a post with top-level tags sends them as post tags.
- Publishing the same file again updates the remote post.
- Updating a file after changing top-level `slug` sends the new slug to mx-space.
- Publishing a note with a missing topic creates the topic.
- Publishing a page succeeds.
- Publishing a file with `![[image.png]]` uploads the image and sends the
  mx-space image URL in the payload.
- Publishing a file that references the same image twice uploads it once.
- Publishing another file with the same image content reuses the cached URL.
- Publishing with a missing local image fails without remote write.
- Unpublishing an existing post writes `publish: false`.
- Unpublishing an existing note writes `publish: false`.
- API key auth publishes content.
- `Mxspub/mxspub-published.base` is created, filters files with `remoteId`,
  defaults to the custom Mxspub view, and includes native overview, recent,
  type-specific, published, and unpublished table fallback views.
