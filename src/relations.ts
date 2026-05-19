import type { MxSpaceApiClient } from './api'
import { isSnowflakeId, makeSlug, relationLabel } from './slug'
import type {
  ApiListResponse,
  CategoryCreatePayload,
  ContentType,
  JsonObject,
  MarkdownFileContext,
  MxCategory,
  MxSpacePublisherSettings,
  MxTopic,
  PublishFrontmatter,
  RelationInput,
  TopicCreatePayload,
} from './types'

interface IdOnlyRelation extends JsonObject {
  id: string
  name?: string
  slug?: string
}

type ResolvableItem = MxCategory | MxTopic | IdOnlyRelation

interface ParsedRelation {
  id?: string
  name: string
  slug: string
  icon?: string
  description?: string
}

export interface ResolvedRelations<T extends ContentType = ContentType> {
  categoryId?: string
  tags?: string[]
  topicId?: string
  frontmatter: Partial<PublishFrontmatter<T>>
}

export class RelationService {
  private categories: MxCategory[] | null = null
  private topics: MxTopic[] | null = null

  constructor(
    private api: MxSpaceApiClient,
    private settings: MxSpacePublisherSettings,
  ) {}

  async resolveForPost(
    context: MarkdownFileContext<'post'>,
  ): Promise<ResolvedRelations<'post'>> {
    const categoryInput =
      context.publish.category || this.settings.defaultPostCategory
    const category = await this.ensureCategory(categoryInput)
    const tags = this.ensureTags(context.publish.tags ?? [])

    return {
      categoryId: category.id,
      frontmatter: {
        category: category.slug ?? category.name ?? category.id,
        tags,
      },
      tags,
    }
  }

  async resolveForNote(
    context: MarkdownFileContext<'note'>,
  ): Promise<ResolvedRelations<'note'>> {
    if (!context.publish.topic) return { frontmatter: {} }
    const topic = await this.ensureTopic(context.publish.topic)
    return {
      frontmatter: {
        topic: topic.slug ?? topic.name ?? topic.id,
      },
      topicId: topic.id,
    }
  }

  async resolveForPage(): Promise<ResolvedRelations<'page'>> {
    return { frontmatter: {} }
  }

  private async ensureCategory(input: RelationInput): Promise<ResolvableItem> {
    const parsed = parseRelation(input)
    if (parsed.id && isSnowflakeId(parsed.id)) return { id: parsed.id }

    const existing = findMatch(await this.loadCategories(), parsed)
    if (existing) return existing

    const body: CategoryCreatePayload = {
      name: parsed.name,
      slug: parsed.slug,
      type: 0,
    }
    const created = await this.api.request<MxCategory>('/categories', {
      body,
      method: 'POST',
    })
    this.categories = [...(this.categories ?? []), created]
    return created
  }

  private ensureTags(inputs: RelationInput[]): string[] {
    return inputs
      .map((input) => parseRelation(input).name)
      .filter((tag, index, tags) => tag.length > 0 && tags.indexOf(tag) === index)
  }

  private async ensureTopic(input: RelationInput): Promise<ResolvableItem> {
    const parsed = parseRelation(input)
    if (parsed.id && isSnowflakeId(parsed.id)) return { id: parsed.id }

    const existing = findMatch(await this.loadTopics(), parsed)
    if (existing) return existing

    const body: TopicCreatePayload = {
      name: parsed.name,
      slug: parsed.slug,
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(parsed.icon ? { icon: parsed.icon } : {}),
    }
    const created = await this.api.request<MxTopic>('/topics', {
      body,
      method: 'POST',
    })
    this.topics = [...(this.topics ?? []), created]
    return created
  }

  private async loadCategories(): Promise<MxCategory[]> {
    if (this.categories) return this.categories
    this.categories = unwrapList(
      await this.api.request<ApiListResponse<MxCategory>>('/categories'),
    )
    return this.categories
  }

  private async loadTopics(): Promise<MxTopic[]> {
    if (this.topics) return this.topics
    this.topics = unwrapList(
      await this.api.request<ApiListResponse<MxTopic>>('/topics/all'),
    )
    return this.topics
  }
}

function parseRelation(input: RelationInput): ParsedRelation {
  if (typeof input === 'string') {
    const value = input.trim()
    return isSnowflakeId(value)
      ? { id: value, name: value, slug: value }
      : { name: value, slug: makeSlug(value) }
  }

  const label = relationLabel(input)
  const name = input.name?.trim() || label || 'Untitled'
  return {
    description: input.description,
    icon: input.icon,
    id: input.id?.trim(),
    name,
    slug: input.slug?.trim() || makeSlug(name),
  }
}

function findMatch(
  items: ReadonlyArray<ResolvableItem>,
  parsed: ParsedRelation,
): ResolvableItem | null {
  const lowerName = parsed.name.toLowerCase()
  const lowerSlug = parsed.slug.toLowerCase()

  return (
    items.find((item) => parsed.id && item.id === parsed.id) ??
    items.find((item) => item.slug && item.slug === parsed.slug) ??
    items.find((item) => item.name && item.name === parsed.name) ??
    items.find(
      (item) => item.slug && item.slug.toLowerCase() === lowerSlug,
    ) ??
    items.find(
      (item) => item.name && item.name.toLowerCase() === lowerName,
    ) ??
    null
  )
}

function unwrapList<T extends JsonObject>(response: ApiListResponse<T>): T[] {
  return Array.isArray(response) ? response : response.data
}
