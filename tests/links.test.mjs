import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import esbuild from 'esbuild'

let module
let tempDir

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mxspub-links-test-'))
  const outfile = path.join(tempDir, 'links.mjs')
  await esbuild.build({
    bundle: true,
    entryPoints: ['src/links.ts'],
    format: 'esm',
    outfile,
    platform: 'node',
    plugins: [
      {
        name: 'obsidian-stub',
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({
            namespace: 'obsidian-stub',
            path: 'obsidian',
          }))
          build.onLoad(
            { filter: /^obsidian$/, namespace: 'obsidian-stub' },
            () => ({
              contents: `
                export class TFile {}
                export function normalizePath(value) {
                  return value.replace(/\\\\/g, '/').replace(/\\/+/g, '/')
                }
                export function getFrontMatterInfo(source) {
                  if (!source.startsWith('---\\n')) return { exists: false, contentStart: 0 }
                  const end = source.indexOf('\\n---', 4)
                  if (end < 0) return { exists: false, contentStart: 0 }
                  const closeEnd = source.indexOf('\\n', end + 4)
                  return {
                    contentStart: closeEnd < 0 ? source.length : closeEnd + 1,
                    exists: true,
                    frontmatter: source.slice(4, end),
                    to: end,
                  }
                }
                export function parseYaml(source) {
                  const result = {}
                  for (const line of source.split(/\\r?\\n/)) {
                    const match = line.match(/^([A-Za-z0-9_-]+):\\s*(.*)$/)
                    if (!match) continue
                    let value = match[2].trim()
                    if (value === 'true') result[match[1]] = true
                    else if (value === 'false') result[match[1]] = false
                    else if (/^-?\\d+$/.test(value)) result[match[1]] = Number(value)
                    else result[match[1]] = value.replace(/^["']|["']$/g, '')
                  }
                  return result
                }
                export function stringifyYaml() {
                  throw new Error('stringifyYaml should not be called by link tests')
                }
                export class Notice {}
              `,
              loader: 'js',
            }),
          )
        },
      },
    ],
  })
  module = await import(pathToFileURL(outfile).href)
})

after(async () => {
  if (tempDir) await rm(tempDir, { force: true, recursive: true })
})

describe('collectInternalLinkReferencesForTest', () => {
  it('collects wiki and markdown links while ignoring embeds, external links, and code', () => {
    const references = module.collectInternalLinkReferencesForTest(
      [
        '[[Post One|Alias]]',
        '[Page](Pages/About.md#Team)',
        '![[image.png]]',
        '[External](https://example.com)',
        '`[[Inline Code]]`',
        '```',
        '[[Fence]]',
        '```',
      ].join('\n'),
    )

    assert.deepEqual(
      references.map((reference) => [
        reference.type,
        reference.rawTarget,
        reference.display,
      ]),
      [
        ['wiki', 'Post One', 'Alias'],
        ['markdown', 'Pages/About.md#Team', 'Page'],
      ],
    )
  })
})

describe('buildNotePublicPathForTest', () => {
  it('prefers mx-space SEO note paths when created and slug are available', () => {
    assert.equal(
      module.buildNotePublicPathForTest({
        created: '2026-05-26T03:04:05.000Z',
        nid: 42,
        slug: 'daily-note',
      }),
      '/notes/2026/5/26/daily-note',
    )
  })

  it('falls back to nid paths', () => {
    assert.equal(
      module.buildNotePublicPathForTest({ nid: 42 }),
      '/notes/42',
    )
  })
})

describe('InternalLinkService', () => {
  it('rewrites published internal links and collects post related ids', async () => {
    const source = fakeFile('Posts/Current.md')
    const linkedPost = fakeFile('Posts/Linked.md')
    const linkedNote = fakeFile('Notes/Day.md')
    const linkedPage = fakeFile('Pages/About.md')
    const app = fakeApp({
      [source.path]: '',
      [linkedPost.path]: frontmatter({
        remoteId: 'post-2',
        slug: 'linked-post',
        title: 'Linked',
        type: 'post',
      }),
      [linkedNote.path]: frontmatter({
        created: '2026-05-26T00:00:00.000Z',
        remoteId: 'note-1',
        slug: 'day',
        title: 'Day',
        type: 'note',
      }),
      [linkedPage.path]: frontmatter({
        remoteId: 'page-1',
        slug: 'about',
        title: 'About',
        type: 'page',
      }),
    }, [source, linkedPost, linkedNote, linkedPage])
    const api = {
      resolvePostPath: async (slug) => `/posts/general/${slug}`,
    }
    const service = new module.InternalLinkService(app, api)

    const result = await service.prepareContext(
      {
        body: [
          'See [[Linked]] and [[Day|today]].',
          '[About](../Pages/About.md#Team)',
          '[[Missing]]',
        ].join('\n'),
        fileBasename: 'Current',
        frontmatter: {},
        mx: {
          id: 'post-1',
          publish: true,
          slug: 'current',
          type: 'post',
        },
        publish: {},
        title: 'Current',
      },
      source,
    )

    assert.deepEqual(result.relatedIds, ['post-2'])
    assert.equal(
      result.context.body,
      [
        'See [Linked](/posts/general/linked-post) and [today](/notes/2026/5/26/day).',
        '[About](/about#Team)',
        '[[Missing]]',
      ].join('\n'),
    )
  })

  it('preserves unpublished targets', async () => {
    const source = fakeFile('Posts/Current.md')
    const draft = fakeFile('Posts/Draft.md')
    const app = fakeApp({
      [source.path]: '',
      [draft.path]: frontmatter({
        publish: false,
        remoteId: 'draft-1',
        slug: 'draft',
        title: 'Draft',
        type: 'post',
      }),
    }, [source, draft])
    const service = new module.InternalLinkService(app, {
      resolvePostPath: async () => '/posts/general/draft',
    })

    const result = await service.prepareContext(
      {
        body: '[[Draft]]',
        fileBasename: 'Current',
        frontmatter: {},
        mx: { id: 'post-1', type: 'post' },
        publish: {},
        title: 'Current',
      },
      source,
    )

    assert.deepEqual(result.relatedIds, [])
    assert.equal(result.context.body, '[[Draft]]')
  })

  it('keeps related ids when post URL resolution fails', async () => {
    const source = fakeFile('Posts/Current.md')
    const linkedPost = fakeFile('Posts/Linked.md')
    const app = fakeApp({
      [source.path]: '',
      [linkedPost.path]: frontmatter({
        remoteId: 'post-2',
        slug: 'linked-post',
        title: 'Linked',
        type: 'post',
      }),
    }, [source, linkedPost])
    const service = new module.InternalLinkService(app, {
      resolvePostPath: async () => null,
    })

    const result = await service.prepareContext(
      {
        body: '[[Linked]]',
        fileBasename: 'Current',
        frontmatter: {},
        mx: { id: 'post-1', type: 'post' },
        publish: {},
        title: 'Current',
      },
      source,
    )

    assert.deepEqual(result.relatedIds, ['post-2'])
    assert.equal(result.context.body, '[[Linked]]')
  })
})

function fakeFile(filePath) {
  return {
    basename: path.basename(filePath, '.md'),
    extension: path.extname(filePath).slice(1),
    name: path.basename(filePath),
    parent: { path: path.dirname(filePath) === '.' ? '' : path.dirname(filePath) },
    path: filePath,
  }
}

function fakeApp(contents, files) {
  const byBasename = new Map(files.map((file) => [file.basename, file]))
  const byPath = new Map(files.map((file) => [file.path, file]))
  return {
    metadataCache: {
      getFirstLinkpathDest(linkpath) {
        const normalized = linkpath.split('\\\\').join('/').replace(/\/+/g, '/')
        if (byPath.has(normalized)) return byPath.get(normalized)
        const withoutExt = normalized.replace(/\\.md$/i, '')
        if (byPath.has(`${withoutExt}.md`)) return byPath.get(`${withoutExt}.md`)
        const basename = path.basename(withoutExt)
        return byBasename.get(basename) ?? null
      },
    },
    vault: {
      cachedRead: async (file) => contents[file.path] ?? '',
      getFileByPath: (filePath) => byPath.get(filePath) ?? null,
    },
  }
}

function frontmatter(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}: ${value}`)
  return `---\n${lines.join('\n')}\n---\n\nBody`
}
