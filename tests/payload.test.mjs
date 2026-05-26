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
  tempDir = await mkdtemp(path.join(tmpdir(), 'mxspub-payload-test-'))
  const outfile = path.join(tempDir, 'payload.mjs')
  await esbuild.build({
    bundle: true,
    entryPoints: ['src/payload.ts'],
    format: 'esm',
    outfile,
    platform: 'node',
  })
  module = await import(pathToFileURL(outfile).href)
})

after(async () => {
  if (tempDir) await rm(tempDir, { force: true, recursive: true })
})

describe('buildPayload', () => {
  it('adds relatedId to post payloads', () => {
    const payload = module.buildPayload({
      context: {
        body: 'Body',
        fileBasename: 'Post',
        frontmatter: {},
        mx: { type: 'post' },
        publish: { title: 'Post' },
        title: 'Post',
      },
      isPublished: true,
      relatedIds: ['post-2', 'post-3'],
      relations: { categoryId: 'cat-1' },
      type: 'post',
    })

    assert.deepEqual(payload.relatedId, ['post-2', 'post-3'])
  })
})
