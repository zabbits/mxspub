import { readFileSync } from 'node:fs'

const bundle = readFileSync('main.js', 'utf8')
const forbidden = [
  '@mx-space/cli',
  'node:',
  'child_process',
  'commander',
  'process.stdin',
  'process.stdout',
  'process.stderr',
]

const hits = forbidden.filter((token) => bundle.includes(token))

if (hits.length > 0) {
  console.error(`Mobile safety check failed: ${hits.join(', ')}`)
  process.exit(1)
}

