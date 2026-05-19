import type { JsonObject, JsonValue, RelationInput } from './types'

const SNOWFLAKE_RE = /^\d{15,}$/

export function isSnowflakeId(value: string): boolean {
  return SNOWFLAKE_RE.test(value)
}

export function normalizeApiUrl(input: string): string {
  let value = input.trim()
  if (!value) return ''
  if (!/^https?:\/\//i.test(value)) {
    const isLocal = /^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/i.test(value)
    value = `${isLocal ? 'http' : 'https'}://${value}`
  }
  return value.replace(/\/+$/, '')
}

export function makeSlug(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/['"]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return normalized || `item-${Date.now().toString(36)}`
}

export function relationLabel(
  value: RelationInput | JsonValue | undefined,
): string | undefined {
  if (typeof value === 'string') return value
  if (!isJsonObject(value)) return
  for (const key of ['slug', 'name', 'id']) {
    const v = value[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
