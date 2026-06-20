# Repository Guidelines

## Project Structure & Module Organization

This repository is a Tauri 2 desktop app with a React/Vite front end and Rust back end. Front-end source lives in `ui/src/`: views in `views/`, reusable UI in `components/`, Tauri invoke wrappers in `api.ts`, helpers in `lib/`, and translations in `messages/`. Rust code lives in `src-tauri/src/`, split by domain: `commands/`, `workflow/`, `db/`, `providers/`, `media/`, `storage/`, and `config/`. Database migrations are in `src-tauri/src/db/migrations/`. Tooling scripts are in `scripts/`; generated outputs such as `dist/`, `target/`, and `node_modules/` should not be edited.

## Build, Test, and Development Commands

Use Bun for JavaScript package tasks.

- `bun install`: install front-end and Tauri CLI dependencies.
- `bun run dev`: start the full Tauri desktop app for local development.
- `bun run ui:dev`: run only the Vite UI server.
- `bun run ui:check`: run TypeScript checking with `tsc --noEmit`.
- `bun run rust:check`: fetch bundled tools, then run Rust compile checks.
- `bun run rust:test`: run Rust unit tests.
- `bun run check`: run the full pre-commit verification path.
- `bun run build` or `bun run build:win`: fetch media tools and package the desktop app.

## Coding Style & Naming Conventions

Use TypeScript, React function components, and the existing Tailwind/Radix style. Prefer `PascalCase` for components and view files, `camelCase` for functions and variables, and kebab-case for small utility modules such as `asset-url.ts`. Use the `@/` alias for imports from `ui/src/`. Format Rust with `rustfmt` and keep modules focused by domain.

## Testing Guidelines

Rust tests are colocated in source files under `#[cfg(test)]`; add regression tests near the code they cover. Run `bun run rust:test` for back-end tests and `bun run ui:check` for front-end validation. There is no front-end test runner or coverage threshold in current scripts, so do not claim coverage without adding tooling.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes such as `feat:` and `fix:`. Keep commit subjects imperative and scoped to one change. Pull requests should include a short summary, verification commands run, linked issues when applicable, and screenshots or screen recordings for UI changes.

## Security & Configuration Tips

Do not commit API keys, local workspace data, generated media, or bundled binary outputs. Keep provider credentials in the app settings/keyring path, and treat `scripts/fetch-tools.ps1` as the source for bundled FFmpeg/Whisper tooling setup.
