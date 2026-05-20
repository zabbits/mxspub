export const CONTENT_TYPES = ['post', 'note', 'page'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

export const PUBLISH_STATES = ['draft', 'publish'] as const
export type PublishState = (typeof PUBLISH_STATES)[number]

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  [key: string]: JsonValue | undefined
}

export type YamlValue = JsonValue
export type YamlObject = JsonObject

export type ContentFormat = 'markdown' | 'lexical'
export type MxCategoryType = 0 | 1

export interface ApiDataList<T extends JsonValue> extends JsonObject {
  data: T[]
}

export type ApiListResponse<T extends JsonValue> = T[] | ApiDataList<T>

export interface MxSpacePublisherSettings {
  apiUrl: string
  apiBase: string
  authBase: string
  apiKeySecretId: string
  defaultType: ContentType
  defaultState: PublishState
  defaultPostCategory: string
  imageUploadCache: ImageUploadCache
}

export const DEFAULT_SETTINGS: MxSpacePublisherSettings = {
  apiUrl: '',
  apiBase: '',
  authBase: '',
  apiKeySecretId: '',
  defaultType: 'post',
  defaultState: 'draft',
  defaultPostCategory: 'General',
  imageUploadCache: {},
}

export interface ImageUploadCacheEntry extends JsonObject {
  url: string
  name: string
  byteSize: number
  sourcePath: string
  uploadedAt: string
  lastUsedAt: string
}

export interface ImageUploadCache extends JsonObject {
  [hash: string]: ImageUploadCacheEntry | undefined
}

export interface EndpointConfig {
  apiUrl: string
  apiBase: string
  authBase: string
}

export interface RelationInputObject extends JsonObject {
  id?: string
  name?: string
  slug?: string
  icon?: string
  description?: string
}

export type RelationInput = string | RelationInputObject

export interface MxPublishMetadata extends JsonObject {
  type?: ContentType
  id?: string
  slug?: string
  publish?: boolean
  published?: string
  updated?: string
}

export interface BasePublishFrontmatter extends JsonObject {
  created?: string
  slug?: string
  title?: string
}

export interface PostPublishFrontmatter extends BasePublishFrontmatter {
  category?: RelationInput
  tags?: RelationInput[]
  summary?: string
}

export interface NotePublishFrontmatter extends BasePublishFrontmatter {
  topic?: RelationInput
  mood?: string
  weather?: string
  publicAt?: string
  location?: string
}

export interface PagePublishFrontmatter extends BasePublishFrontmatter {
  subtitle?: string
  order?: number
}

export interface PublishFrontmatterByType {
  post: PostPublishFrontmatter
  note: NotePublishFrontmatter
  page: PagePublishFrontmatter
}

export type PublishFrontmatter<T extends ContentType> =
  PublishFrontmatterByType[T]

export interface MarkdownFileContext<T extends ContentType = ContentType> {
  body: string
  frontmatter: YamlObject
  mx: MxPublishMetadata
  publish: PublishFrontmatter<T>
  title: string
  fileBasename: string
}

export interface ApiErrorDetails {
  status?: number
  body?: JsonValue
}

export interface MxImage extends JsonObject {
  width?: number
  height?: number
  accent?: string
  type?: string
  src?: string
  blurHash?: string
  blur_hash?: string
}

export interface MxCategoryRef extends JsonObject {
  id: string
  name: string
  slug: string
  type: MxCategoryType | number
}

export interface MxCategory extends MxCategoryRef {
  createdAt?: string
  created_at?: string
  count?: number
}

export interface MxTagSummary extends JsonObject {
  name: string
  count: number
}

export interface MxTopic extends JsonObject {
  id: string
  name: string
  slug: string
  description: string
  introduce: string | null
  icon: string | null
  createdAt?: string
  created_at?: string
}

export interface MxPostRelatedSummary extends JsonObject {
  id: string
  title: string
  slug: string
  summary: string | null
  categoryId?: string
  category_id?: string
  category?: MxCategoryRef
  createdAt?: string
  created_at?: string
  modifiedAt?: string | null
  modified_at?: string | null
}

export interface MxPost extends JsonObject {
  id: string
  title: string
  slug: string
  text: string
  content: string | null
  contentFormat?: ContentFormat | string
  content_format?: ContentFormat | string
  summary: string | null
  images: MxImage[] | null
  meta: JsonObject | null
  tags: string[]
  modifiedAt?: string | null
  modified_at?: string | null
  categoryId?: string
  category_id?: string
  category?: MxCategoryRef
  copyright: boolean
  isPublished?: boolean
  is_published?: boolean
  readCount?: number
  read_count?: number
  likeCount?: number
  like_count?: number
  pinAt?: string | null
  pin_at?: string | null
  pinOrder?: number | null
  pin_order?: number | null
  createdAt?: string
  created_at?: string
  related?: MxPostRelatedSummary[]
  relatedId?: string[]
  related_id?: string[]
}

export interface MxNoteTopicRef extends JsonObject {
  id: string
  name: string
  slug: string
  description: string
  introduce: string | null
  icon: string | null
  createdAt?: string
  created_at?: string
}

export interface MxCoordinates extends JsonObject {
  latitude: number
  longitude: number
}

export interface MxNote extends JsonObject {
  id: string
  nid: number
  title: string
  slug: string | null
  text: string
  content: string | null
  contentFormat?: ContentFormat | string
  content_format?: ContentFormat | string
  images: MxImage[] | null
  meta: JsonObject | null
  isPublished?: boolean
  is_published?: boolean
  hasPassword?: boolean
  has_password?: boolean
  publicAt?: string | null
  public_at?: string | null
  mood: string | null
  weather: string | null
  bookmark: boolean
  coordinates: MxCoordinates | null
  location: string | null
  readCount?: number
  read_count?: number
  likeCount?: number
  like_count?: number
  topicId?: string | null
  topic_id?: string | null
  topic?: MxNoteTopicRef | null
  createdAt?: string
  created_at?: string
  modifiedAt?: string | null
  modified_at?: string | null
  password?: string | null
}

export interface MxPage extends JsonObject {
  id: string
  title: string
  slug: string
  subtitle: string | null
  text: string
  content: string | null
  contentFormat?: ContentFormat | string
  content_format?: ContentFormat | string
  images: MxImage[] | null
  meta: JsonObject | null
  order: number
  createdAt?: string
  created_at?: string
  modifiedAt?: string | null
  modified_at?: string | null
}

export interface BaseWritePayload extends JsonObject {
  title: string
  text: string
  content: string
  contentFormat: ContentFormat
  created?: string
  slug?: string
  images?: MxImage[]
  meta?: JsonObject | null
}

export interface MxPostPayload extends BaseWritePayload {
  slug: string
  categoryId?: string
  isPublished: boolean
  tags?: string[]
  summary?: string
  copyright?: boolean
  relatedId?: string[]
}

export interface MxNotePayload extends BaseWritePayload {
  isPublished: boolean
  topicId?: string
  mood?: string
  weather?: string
  publicAt?: string
  password?: string
  bookmark?: boolean
  coordinates?: MxCoordinates
  location?: string
}

export interface MxPagePayload extends BaseWritePayload {
  slug: string
  subtitle?: string
  order?: number
}

export type PublishPayload = MxPostPayload | MxNotePayload | MxPagePayload

export interface CategoryCreatePayload extends JsonObject {
  name: string
  slug: string
  type?: MxCategoryType
}

export interface TopicCreatePayload extends JsonObject {
  name: string
  slug: string
  description?: string
  introduce?: string | null
  icon?: string | null
}

export interface PublishStatusPayload extends JsonObject {
  isPublished: boolean
}

export interface PublishStatusResponse extends JsonObject {
  success: boolean
}

export interface FileUploadResponse extends JsonObject {
  url: string
  name: string
}
