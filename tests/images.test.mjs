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
  tempDir = await mkdtemp(path.join(tmpdir(), 'mxspub-images-test-'))
  const outfile = path.join(tempDir, 'images.mjs')
  await esbuild.build({
    bundle: true,
    entryPoints: ['src/images.ts'],
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
                export async function requestUrl() {
                  throw new Error('requestUrl should not be called by parser tests')
                }
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

describe('collectImageReferencesForTest', () => {
  it('keeps images nested in list item continuations', () => {
    const references = module.collectImageReferencesForTest([
      '- item',
      '    ![nested](img.png)',
    ].join('\n'))

    assert.deepEqual(
      references.map((reference) => reference.rawTarget),
      ['img.png'],
    )
  })

  it('does not close fenced code blocks on fence-like lines with info text', () => {
    const markdown = [
      '```',
      '```js',
      '![inside](ignored.png)',
      '```',
      '![outside](kept.png)',
    ].join('\n')
    const references = module.collectImageReferencesForTest(markdown)

    assert.deepEqual(
      references.map((reference) => reference.rawTarget),
      ['kept.png'],
    )
  })

  it('keeps images between stray backticks in separate paragraphs', () => {
    const markdown = [
      'first `literal',
      '',
      '![valid](img.png)',
      '',
      'later `literal',
    ].join('\n')
    const references = module.collectImageReferencesForTest(markdown)

    assert.deepEqual(
      references.map((reference) => reference.rawTarget),
      ['img.png'],
    )
  })

  it('ignores images inside blockquote fenced code blocks', () => {
    const markdown = [
      '> ~~~',
      '> ![inside](ignored.png)',
      '> ~~~',
      '',
      '![outside](kept.png)',
    ].join('\n')
    const references = module.collectImageReferencesForTest(markdown)

    assert.deepEqual(
      references.map((reference) => reference.rawTarget),
      ['kept.png'],
    )
  })

  it('ignores images inside list-item fenced code blocks', () => {
    const markdown = [
      '- item',
      '  ```',
      '  ![inside](ignored.png)',
      '  ```',
      '',
      '![outside](kept.png)',
    ].join('\n')
    const references = module.collectImageReferencesForTest(markdown)

    assert.deepEqual(
      references.map((reference) => reference.rawTarget),
      ['kept.png'],
    )
  })

  it('keeps Markdown image destinations with parentheses', () => {
    const references = module.collectImageReferencesForTest(
      '![paren](assets/foo (1).png)',
    )

    assert.deepEqual(
      references.map((reference) => reference.rawTarget),
      ['assets/foo (1).png'],
    )
  })

  it('collects wiki embeds in text but ignores them in code', () => {
    const markdown = [
      '![[visible.png|Visible]]',
      '',
      '`![[inline.png]]`',
      '',
      '```',
      '![[fenced.png]]',
      '```',
    ].join('\n')
    const references = module.collectImageReferencesForTest(markdown)

    assert.deepEqual(
      references.map((reference) => reference.rawTarget),
      ['visible.png'],
    )
  })

  it('collects Excalidraw wiki embeds', () => {
    const markdown = [
      '![[diagram.excalidraw]]',
      '![[sketch.excalidraw.md|Sketch]]',
      '`![[inline.excalidraw]]`',
    ].join('\n')
    const references = module.collectImageReferencesForTest(markdown)

    assert.deepEqual(
      references.map((reference) => [reference.rawTarget, reference.alt]),
      [
        ['diagram.excalidraw', 'diagram'],
        ['sketch.excalidraw.md', 'Sketch'],
      ],
    )
  })

  it('uses source offsets for wiki embeds after decoded character references', () => {
    const markdown = 'a &amp; ![[img.png]]'
    const references = module.collectImageReferencesForTest(markdown)
    const [reference] = references

    assert.equal(reference.rawTarget, 'img.png')
    assert.equal(markdown.slice(reference.start, reference.end), '![[img.png]]')
  })

  it('uses source offsets for fallback images after decoded character references', () => {
    const markdown = 'a &amp; ![fallback](assets/foo (1).png)'
    const references = module.collectImageReferencesForTest(markdown)
    const [reference] = references

    assert.equal(reference.rawTarget, 'assets/foo (1).png')
    assert.equal(
      markdown.slice(reference.start, reference.end),
      '![fallback](assets/foo (1).png)',
    )
  })
})

describe('ImageUploadService Excalidraw support', () => {
  after(() => {
    delete globalThis.ExcalidrawAutomate
  })

  it('exports Excalidraw embeds to SVG and uploads them as images', async () => {
    const excalidrawFile = fakeFile('Drawings/diagram.excalidraw.md')
    const sourceFile = fakeFile('Posts/post.md')
    const app = fakeApp([sourceFile, excalidrawFile])
    const uploads = []
    const settings = fakeSettings()
    const service = new module.ImageUploadService(
      app,
      settings,
      fakeApi(uploads),
      async () => {},
    )
    globalThis.ExcalidrawAutomate = {
      createSVG: async (...args) => {
        assert.deepEqual(args, [
          'Drawings/diagram.excalidraw.md',
          false,
          { withBackground: false },
          undefined,
          'light',
          10,
          false,
          false,
        ])
        return '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>'
      },
      isExcalidrawFile: (file) => file.path.endsWith('.excalidraw.md'),
      reset: () => {},
    }

    const context = fakeContext('before ![[diagram.excalidraw.md|Diagram]] after')
    const prepared = await service.prepareContext(context, sourceFile)

    assert.equal(
      prepared.body,
      'before ![Diagram](https://img.example/diagram.svg) after',
    )
    assert.equal(uploads.length, 1)
    assert.equal(uploads[0].contentType, 'image/svg+xml')
    assert.equal(uploads[0].filename, 'diagram.svg')
  })

  it('reuses cached exported SVG uploads', async () => {
    const excalidrawFile = fakeFile('diagram.excalidraw')
    const sourceFile = fakeFile('post.md')
    const app = fakeApp([sourceFile, excalidrawFile])
    const uploads = []
    const settings = fakeSettings()
    const service = new module.ImageUploadService(
      app,
      settings,
      fakeApi(uploads),
      async () => {},
    )
    globalThis.ExcalidrawAutomate = {
      createSVG: async () => '<svg xmlns="http://www.w3.org/2000/svg" />',
      isExcalidrawFile: () => true,
    }

    await service.prepareContext(fakeContext('![[diagram.excalidraw]]'), sourceFile)
    const prepared = await service.prepareContext(
      fakeContext('again ![[diagram.excalidraw]]'),
      sourceFile,
    )

    assert.equal(uploads.length, 1)
    assert.equal(prepared.body, 'again ![diagram](https://img.example/diagram.svg)')
  })

  it('fails before upload when ExcalidrawAutomate is unavailable', async () => {
    const excalidrawFile = fakeFile('diagram.excalidraw')
    const sourceFile = fakeFile('post.md')
    const app = fakeApp([sourceFile, excalidrawFile])
    const uploads = []
    const service = new module.ImageUploadService(
      app,
      fakeSettings(),
      fakeApi(uploads),
      async () => {},
    )
    delete globalThis.ExcalidrawAutomate

    await assert.rejects(
      () => service.prepareContext(fakeContext('![[diagram.excalidraw]]'), sourceFile),
      /Enable or update the Excalidraw plugin/,
    )
    assert.equal(uploads.length, 0)
  })

  it('leaves Excalidraw embeds unchanged when export is disabled', async () => {
    const excalidrawFile = fakeFile('diagram.excalidraw')
    const sourceFile = fakeFile('post.md')
    const app = fakeApp([sourceFile, excalidrawFile])
    const uploads = []
    const settings = {
      ...fakeSettings(),
      exportExcalidrawAsSvg: false,
    }
    const service = new module.ImageUploadService(
      app,
      settings,
      fakeApi(uploads),
      async () => {},
    )
    delete globalThis.ExcalidrawAutomate

    const prepared = await service.prepareContext(
      fakeContext('keep ![[diagram.excalidraw]]'),
      sourceFile,
    )

    assert.equal(prepared.body, 'keep ![[diagram.excalidraw]]')
    assert.equal(uploads.length, 0)
  })
})

function fakeFile(filePath) {
  const name = path.basename(filePath)
  const extension = name.includes('.') ? name.split('.').pop() : ''
  return {
    basename: name.replace(/\.[^.]+$/, ''),
    extension,
    name,
    parent: { path: path.dirname(filePath) === '.' ? '' : path.dirname(filePath) },
    path: filePath,
  }
}

function fakeApp(files) {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const byName = new Map(files.map((file) => [file.name, file]))
  return {
    metadataCache: {
      getFirstLinkpathDest: (target) => byPath.get(target) ?? byName.get(target) ?? null,
    },
    vault: {
      getFileByPath: (target) => byPath.get(target) ?? null,
      readBinary: async (file) => new TextEncoder().encode(file.path).buffer,
    },
  }
}

function fakeApi(uploads) {
  return {
    uploadImage: async (upload) => {
      uploads.push(upload)
      return {
        name: upload.filename,
        url: `https://img.example/${upload.filename}`,
      }
    },
  }
}

function fakeContext(body) {
  return {
    body,
    fileBasename: 'post',
    frontmatter: {},
    mx: {},
    publish: {},
    title: 'post',
  }
}

function fakeSettings() {
  return {
    apiBase: '',
    apiKeySecretId: '',
    apiUrl: '',
    authBase: '',
    defaultPostCategory: 'General',
    defaultType: 'post',
    exportExcalidrawAsSvg: true,
    imageUploadCache: {},
  }
}
