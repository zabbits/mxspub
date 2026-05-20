# Mxspub Agent Notes

## Scope

This repository contains an Obsidian plugin for publishing Markdown files to
mx-space.

## Commands

- `pnpm install`: install dependencies.
- `pnpm typecheck`: run TypeScript without emitting files.
- `pnpm build`: typecheck and bundle `main.js`.

## Notes

- Use Obsidian APIs such as `requestUrl` and `SecretStorage` for runtime work.
- Treat `main.js` and source maps as generated build artifacts.
- Keep agent notes focused on repository workflow. Put feature behavior,
  implementation contracts, and acceptance criteria in project documentation.

## Documentation

- Update `README.md` when setup, commands, or user-facing behavior changes.
- Update `docs/implementation.md` when the implementation contract, API
  behavior, or acceptance checklist changes.
