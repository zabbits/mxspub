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

- The primary command is `MX Space: Publish current file`.
- The companion command is `MX Space: Unpublish current file`.
- `MX Space: Check API key` verifies the selected SecretStorage API key against
  the configured mx-space endpoint.
- The plugin determines the target content type from `mxspace.type` in the
  current file's frontmatter.
- If `mxspace.type` is missing, the plugin opens a type picker and writes the
  selected type back as part of the successful publish result.
- If `mxspace.id` exists, publish updates the remote document.
- If `mxspace.id` is missing, publish creates a remote document.
- `mxspace.state` controls draft/published state for posts and notes.
- `MX Space: Unpublish current file` explicitly sets the remote post/note to
  draft. Pages do not support unpublish.

## Settings

- `apiUrl`: mx-core origin, for example `https://blog.example.com`.
- `apiKeySecretId`: optional Obsidian SecretStorage id for an `x-api-key`
  credential.
- `defaultType`: fallback content type when a file has no `mxspace.type`.
- `defaultState`: fallback publish state for posts and notes.
- `defaultPostCategory`: category used when a post has no top-level
  `category`.
- `apiBase` and `authBase`: probed endpoint bases cached after connection
  discovery.

## Frontmatter Contract

Common publish metadata always lives under `mxspace`:

```yaml
mxspace:
  type: post
  id: "1234567890"
  slug: "example"
  state: draft
  lastPublishedAt: "2026-05-18T12:00:00.000Z"
```

Post-specific fields live at the top level:

```yaml
title: "Example"
created: "2026-05-01T09:00:00.000Z"
category: "tech"
tags: ["cli", "obsidian"]
summary: "Summary"
mxspace:
  type: post
  state: draft
```

Note-specific fields live at the top level:

```yaml
title: "Daily note"
created: "2026-05-01T09:00:00.000Z"
topic: "daily"
mood: "calm"
weather: "sunny"
publicAt: "2026-05-18T12:00:00.000Z"
location: "Singapore"
mxspace:
  type: note
  state: draft
```

Page-specific fields live at the top level:

```yaml
title: "About"
created: "2026-05-01T09:00:00.000Z"
subtitle: "About this site"
order: 10
mxspace:
  type: page
```

Legacy fields such as `mxspace.category`, `mxspace.tags`, `mxspace.topic`, and
other type-specific values are not written by the plugin. A successful publish
rewrites `mxspace` using only the common metadata above.

Rules:

- `mxspace.type` is `post`, `note`, or `page`.
- `mxspace.state` is `draft` or `publish`; it only applies to posts and notes.
- `title` priority is top-level `title`, then file basename.
- Top-level `created` controls the remote content `createdAt` value for posts
  and notes. If `created` is absent, the server chooses the creation time on
  create and leaves it unchanged on update. Top-level `createdAt` is accepted as
  a read alias but the plugin writes `created` when it needs to persist a value.
- `mxspace.slug` defaults to a generated slug from the file basename.
- Posts require a category. If top-level `category` is missing, the plugin uses
  the settings default post category and auto-creates it when needed.
- Post `category` and note `topic` can be an id, slug, or name.
- Missing categories and topics are created automatically.
- Post `tags` are normalized to `tags: string[]`; they are not created through
  the category API because mx-core exposes tags as post metadata/aggregates
  rather than editable tag records.
- Publishing success writes back `mxspace.id`, `mxspace.slug`,
  `mxspace.state`, and `mxspace.lastPublishedAt`.
- Auto-created or resolved relations are normalized back into top-level
  frontmatter (`category`, `tags`, or `topic`), not into `mxspace`.
- `mxspace` is always written as a YAML block, never as a JSON string or inline
  object.

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
- `contentFormat` is always `markdown`.
- `text` is the Markdown body and remains the rendering/search source.
- `content` is a valid Lexical editor-state JSON snapshot generated from the
  Markdown body, so mx-core front-end editors that parse `content` directly can
  open plugin-published documents without throwing JSON parse errors.
- Top-level frontmatter `created` is sent as API payload `created`.
- API calls use concrete TypeScript response models derived from mx-core
  controller/schema/types: `MxPost`, `MxNote`, `MxPage`, `MxCategory`,
  `MxTopic`, list wrappers, and publish status responses.

## Implementation Files

- `src/main.ts`: plugin entry and commands.
- `src/settings.ts`: settings tab and persisted settings.
- `src/secrets.ts`: SecretStorage helpers for API keys.
- `src/auth.ts`: API key auth headers.
- `src/api.ts`: requestUrl-based HTTP client and endpoint probing.
- `src/payload.ts`: Markdown payload builders.
- `src/relations.ts`: category/topic resolution/creation and tag normalization.
- `src/frontmatter.ts`: active file extraction and `mxspace` updates.
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
- Missing remote content asks the user to remove `mxspace.id` and republish.
- Relation creation failure stops the publish and names the failing relation.
- Server validation errors show the server message when available.
- Network errors show the API URL and failed stage.

Errors are optimized for Obsidian user feedback, not CLI error-code parity.

## Acceptance Tests

- `pnpm build` succeeds.
- Publishing a new post with a missing category creates the category.
- Publishing a post with top-level tags sends them as post tags.
- Publishing the same file again updates the remote post.
- Publishing a note with a missing topic creates the topic.
- Publishing a page succeeds.
- Unpublishing an existing post switches it to draft.
- Unpublishing an existing note switches it to draft.
- API key auth publishes content.
