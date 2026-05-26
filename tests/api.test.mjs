import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

import esbuild from 'esbuild'

let module
let tempDir

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'mxspub-api-test-'))
  const outfile = path.join(tempDir, 'api.mjs')
  await esbuild.build({
    bundle: true,
    entryPoints: ['src/api.ts'],
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
                export async function requestUrl(request) {
                  return globalThis.__mxspubRequestUrl(request)
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

beforeEach(() => {
  globalThis.__mxspubRequests = []
  globalThis.__mxspubRequestUrl = async (request) => {
    globalThis.__mxspubRequests.push(request)
    return { status: 204, text: '' }
  }
})

after(async () => {
  delete globalThis.__mxspubRequestUrl
  delete globalThis.__mxspubRequests
  if (tempDir) await rm(tempDir, { force: true, recursive: true })
})

describe('objectImageDeleteTargetForTest', () => {
  it('extracts local mx-space object image names', () => {
    assert.equal(
      module.objectImageDeleteTargetForTest(
        'https://blog.example.com/objects/image/foo.png',
        'https://blog.example.com/api/v2',
      ),
      'foo.png',
    )
  })

  it('extracts nested object image names', () => {
    assert.equal(
      module.objectImageDeleteTargetForTest(
        'https://blog.example.com/objects/image/folder/foo%201.png',
        'https://blog.example.com/api/v2',
      ),
      'folder/foo 1.png',
    )
  })

  it('ignores non-local image URLs', () => {
    assert.equal(
      module.objectImageDeleteTargetForTest(
        'https://cdn.example.com/image/foo.png',
        'https://blog.example.com/api/v2',
      ),
      null,
    )
  })
})

describe('normalizePostPublicPathForTest', () => {
  it('adds the frontend post route prefix to mx-core slug resolver paths', () => {
    assert.equal(
      module.normalizePostPublicPathForTest('/misc/foo'),
      '/posts/misc/foo',
    )
    assert.equal(
      module.normalizePostPublicPathForTest('misc/foo'),
      '/posts/misc/foo',
    )
  })

  it('does not duplicate existing post route prefixes', () => {
    assert.equal(
      module.normalizePostPublicPathForTest('/posts/misc/foo'),
      '/posts/misc/foo',
    )
  })

  it('returns null for invalid post paths', () => {
    assert.equal(module.normalizePostPublicPathForTest(undefined), null)
    assert.equal(module.normalizePostPublicPathForTest(''), null)
  })
})

describe('MxSpaceApiClient.resolvePostPath', () => {
  it('normalizes post paths returned by mx-space', async () => {
    globalThis.__mxspubRequestUrl = async (request) => {
      globalThis.__mxspubRequests.push(request)
      return { status: 200, text: '{"path":"/misc/foo"}' }
    }
    const client = new module.MxSpaceApiClient({
      apiBase: 'https://blog.example.com/api/v2',
    })

    assert.equal(await client.resolvePostPath('foo'), '/posts/misc/foo')
    assert.equal(
      globalThis.__mxspubRequests[0].url,
      'https://blog.example.com/api/v2/posts/get-url/foo',
    )
  })

  it('keeps already-prefixed post paths', async () => {
    globalThis.__mxspubRequestUrl = async (request) => {
      globalThis.__mxspubRequests.push(request)
      return { status: 200, text: '{"path":"/posts/misc/foo"}' }
    }
    const client = new module.MxSpaceApiClient({
      apiBase: 'https://blog.example.com/api/v2',
    })

    assert.equal(await client.resolvePostPath('foo'), '/posts/misc/foo')
  })

  it('returns null when mx-space cannot resolve the post path', async () => {
    globalThis.__mxspubRequestUrl = async (request) => {
      globalThis.__mxspubRequests.push(request)
      return { status: 404, text: '{"message":"not found"}' }
    }
    const client = new module.MxSpaceApiClient({
      apiBase: 'https://blog.example.com/api/v2',
    })

    assert.equal(await client.resolvePostPath('foo'), null)
  })
})

describe('MxSpaceApiClient.deleteImage', () => {
  it('deletes local mx-space object images directly', async () => {
    const client = new module.MxSpaceApiClient({
      apiBase: 'https://blog.example.com/api/v2',
    })

    await client.deleteImage({
      name: 'ignored.png',
      url: 'https://blog.example.com/objects/image/foo.png',
    })

    assert.equal(globalThis.__mxspubRequests.length, 1)
    assert.equal(globalThis.__mxspubRequests[0].method, 'DELETE')
    assert.equal(
      globalThis.__mxspubRequests[0].url,
      'https://blog.example.com/api/v2/objects/image/foo.png',
    )
  })

  it('encodes nested image names for deletion', async () => {
    const client = new module.MxSpaceApiClient({
      apiBase: 'https://blog.example.com/api/v2',
    })

    await client.deleteImage({
      name: 'ignored.png',
      url: 'https://blog.example.com/objects/image/folder/foo%201.png',
    })

    assert.equal(
      globalThis.__mxspubRequests[0].url,
      'https://blog.example.com/api/v2/objects/image/folder%2Ffoo%201.png',
    )
  })

  it('deletes matching orphan records for non-local URLs', async () => {
    globalThis.__mxspubRequestUrl = async (request) => {
      globalThis.__mxspubRequests.push(request)
      if (request.method === 'DELETE') {
        return { status: 200, text: '{"deletedCount":1}' }
      }
      return {
        status: 200,
        text: JSON.stringify({
          data: [
            { id: 'other', fileUrl: 'https://cdn.example.com/other.png' },
            { id: 'target', fileUrl: 'https://cdn.example.com/foo.png' },
          ],
        }),
      }
    }
    const client = new module.MxSpaceApiClient({
      apiBase: 'https://blog.example.com/api/v2',
    })

    await client.deleteImage({
      name: 'foo.png',
      url: 'https://cdn.example.com/foo.png',
    })

    assert.equal(globalThis.__mxspubRequests.length, 2)
    assert.equal(
      globalThis.__mxspubRequests[0].url,
      'https://blog.example.com/api/v2/objects/orphans/list?page=1&size=500',
    )
    assert.equal(globalThis.__mxspubRequests[1].method, 'DELETE')
    assert.equal(
      globalThis.__mxspubRequests[1].url,
      'https://blog.example.com/api/v2/objects/orphans/batch',
    )
    assert.equal(globalThis.__mxspubRequests[1].body, '{"ids":["target"]}')
  })

  it('fails when a non-local URL cannot be matched to an orphan', async () => {
    globalThis.__mxspubRequestUrl = async (request) => {
      globalThis.__mxspubRequests.push(request)
      return { status: 200, text: '{"data":[]}' }
    }
    const client = new module.MxSpaceApiClient({
      apiBase: 'https://blog.example.com/api/v2',
    })

    await assert.rejects(
      () =>
        client.deleteImage({
          name: 'foo.png',
          url: 'https://cdn.example.com/foo.png',
        }),
      /Cannot find a mx-space object record/,
    )
    assert.equal(globalThis.__mxspubRequests.length, 1)
  })
})
