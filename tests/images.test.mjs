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
})
