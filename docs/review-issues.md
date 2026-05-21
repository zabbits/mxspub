# Review Issues

## 2026-05-20 repo review

- [x] Image reference parsing should ignore fenced code blocks, indented code
  blocks, and inline code so code samples do not trigger image uploads.
- [x] Markdown image destinations should support valid paths containing
  parentheses.
- [x] Cached image entries should keep `sourcePath` aligned with the current
  local file when a content-hash cache hit is reused.
- [x] Updating remote content should prefer a server-returned slug when
  mx-space normalizes or changes it.
- [x] Image reference parsing should not treat normal list-item continuations
  as indented code blocks.
- [x] Fenced code parsing should only close a fence when the closing fence is
  followed by trailing spaces, not an info string or other content.
- [x] Inline code parsing should not pair stray backticks across Markdown
  blocks and hide valid images between paragraphs.
- [x] Image reference parsing should ignore fenced code blocks nested in common
  Markdown containers such as block quotes and list items.
- [x] Fallback image scanners should use source text offsets instead of
  mdast-decoded text offsets.
