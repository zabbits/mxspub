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
  tempDir = await mkdtemp(path.join(tmpdir(), 'mxspub-management-test-'))
  const outfile = path.join(tempDir, 'management.mjs')
  await esbuild.build({
    bundle: true,
    entryPoints: ['src/management.ts'],
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
                export class BasesView {}
                export class ItemView {}
                export class TFile {}
                export class WorkspaceLeaf {}
                export class Modal {}
                export class Setting {}
                export class Notice {}
                export function normalizePath(value) {
                  return value.replace(/\\\\/g, '/').replace(/\\/+/g, '/')
                }
                export function setIcon() {}
                export async function requestUrl() {
                  throw new Error('requestUrl should not be called by management tests')
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

describe('imagePreviewForRowForTest', () => {
  it('uses the uploaded SVG URL for Excalidraw source files', () => {
    const preview = module.imagePreviewForRowForTest(
      fakeRow({
        sourcePath: 'Drawings/diagram.excalidraw.md',
        url: 'https://img.example/diagram.svg',
      }),
      true,
    )

    assert.deepEqual(preview, {
      src: 'https://img.example/diagram.svg',
      type: 'excalidraw',
    })
  })

  it('uses the local resource path for normal images', () => {
    const preview = module.imagePreviewForRowForTest(
      fakeRow({
        sourcePath: 'assets/photo.png',
        url: 'https://img.example/photo.png',
      }),
      true,
    )

    assert.deepEqual(preview, {
      src: 'app://resource/assets/photo.png',
      type: 'local',
    })
  })

  it('keeps missing previews for non-Excalidraw rows without source files', () => {
    const preview = module.imagePreviewForRowForTest(
      fakeRow({
        sourcePath: 'assets/photo.png',
        url: 'https://img.example/photo.png',
      }),
      false,
    )

    assert.equal(preview, null)
  })
})

function fakeRow(overrides) {
  return {
    byteSize: 100,
    lastUsedAt: '2026-05-26T00:00:00.000Z',
    name: 'image.svg',
    sourcePath: 'image.svg',
    uploadedAt: '2026-05-26T00:00:00.000Z',
    url: 'https://img.example/image.svg',
    ...overrides,
  }
}
