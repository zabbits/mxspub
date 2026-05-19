import type { JsonObject } from './types'

interface LexicalTextNode extends JsonObject {
  detail: number
  format: number
  mode: 'normal'
  style: string
  text: string
  type: 'text'
  version: number
}

interface LexicalLineBreakNode extends JsonObject {
  type: 'linebreak'
  version: number
}

interface LexicalParagraphNode extends JsonObject {
  children: Array<LexicalTextNode | LexicalLineBreakNode>
  direction: null
  format: string
  indent: number
  textFormat: number
  textStyle: string
  type: 'paragraph'
  version: number
}

interface LexicalRootNode extends JsonObject {
  children: LexicalParagraphNode[]
  direction: null
  format: string
  id: 'root'
  indent: number
  type: 'root'
  version: number
}

interface LexicalEditorState extends JsonObject {
  root: LexicalRootNode
}

export function markdownToEditorStateJson(markdown: string): string {
  return JSON.stringify(markdownToEditorState(markdown))
}

function markdownToEditorState(markdown: string): LexicalEditorState {
  const blocks = markdown.trim().length ? markdown.split(/\n{2,}/) : ['']
  return {
    root: {
      children: blocks.map((block) => paragraphNode(block)),
      direction: null,
      format: '',
      id: 'root',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }
}

function paragraphNode(markdown: string): LexicalParagraphNode {
  return {
    children: inlineNodes(markdown),
    direction: null,
    format: '',
    indent: 0,
    textFormat: 0,
    textStyle: '',
    type: 'paragraph',
    version: 1,
  }
}

function inlineNodes(markdown: string): Array<LexicalTextNode | LexicalLineBreakNode> {
  const lines = markdown.split(/\n/)
  const nodes: Array<LexicalTextNode | LexicalLineBreakNode> = []

  lines.forEach((line, index) => {
    if (line.length) nodes.push(textNode(line))
    if (index < lines.length - 1) nodes.push({ type: 'linebreak', version: 1 })
  })

  return nodes
}

function textNode(text: string): LexicalTextNode {
  return {
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
    text,
    type: 'text',
    version: 1,
  }
}
