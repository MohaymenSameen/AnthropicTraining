# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

UIGen is an AI-powered React component generator with live in-browser preview. Users describe components in a chat interface, and the AI generates React code that renders in a sandboxed iframe preview. No files are written to disk — everything runs through a virtual file system.

## Commands

- `npm run setup` — install deps, generate Prisma client, run migrations (first-time setup)
- `npm run dev` — start dev server with Turbopack (requires `node-compat.cjs` via NODE_OPTIONS)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm test` — run all tests with Vitest (jsdom environment)
- `npx vitest run src/lib/__tests__/file-system.test.ts` — run a single test file
- `npx prisma migrate dev` — apply pending migrations
- `npm run db:reset` — reset database (destructive)

## Architecture

### Data Flow

1. User sends a message via the chat UI (`ChatProvider` → `POST /api/chat`)
2. The API route (`src/app/api/chat/route.ts`) streams responses using Vercel AI SDK's `streamText` with two tools: `str_replace_editor` and `file_manager`
3. Tool calls modify a `VirtualFileSystem` instance on the server; the client mirrors those changes via `onToolCall` in `ChatProvider` → `FileSystemProvider.handleToolCall`
4. `PreviewFrame` watches for file changes, transforms JSX/TSX via `@babel/standalone` in the browser, builds an import map with blob URLs, and renders everything in an iframe

### Key Abstractions

- **VirtualFileSystem** (`src/lib/file-system.ts`) — in-memory file tree with create/read/update/delete/rename, str_replace, and insert operations. Serializes to/from JSON for persistence and client-server transfer.
- **AI Tools** — `str_replace_editor` (view/create/str_replace/insert) and `file_manager` (rename/delete) in `src/lib/tools/`. These operate on the VFS and return results to the AI.
- **JSX Transformer** (`src/lib/transform/jsx-transformer.ts`) — client-side Babel transform that builds an import map. Third-party imports resolve via `esm.sh`, local imports via blob URLs. Missing local imports get placeholder modules.
- **Mock Provider** (`src/lib/provider.ts`) — when `ANTHROPIC_API_KEY` is unset, a `MockLanguageModel` returns static component code so the app works without an API key.

### Context Providers

The app uses two React contexts that wrap `MainContent`:
- `FileSystemProvider` — owns the client-side VFS, handles tool call side effects, manages selected file state
- `ChatProvider` — wraps `@ai-sdk/react`'s `useChat`, sends VFS state with each request, tracks anonymous work

### Routes

- `/` — anonymous users see the editor; authenticated users redirect to their most recent project (or a new one is created)
- `/[projectId]` — loads a saved project (auth required)
- `/api/chat` — streaming chat endpoint

### Database

SQLite via Prisma. The database schema is defined in `prisma/schema.prisma` — refer to this file to understand the datastore structure. Prisma client output is at `src/generated/prisma`.

### Auth

JWT-based with `jose`. Session stored in cookies. `src/lib/auth.ts` handles sign-up/sign-in/session verification. Middleware protects `/api/projects` and `/api/filesystem` routes.

### Generated Component Conventions

The AI is instructed (via `src/lib/prompts/generation.tsx`) to:
- Always create `/App.jsx` as the root entry point with a default export
- Use Tailwind CSS for styling (preview loads Tailwind via CDN)
- Use `@/` import alias for local files (e.g., `@/components/Calculator`)
- Not create HTML files — only JSX/TSX

### Node.js Compatibility

`node-compat.cjs` removes `localStorage`/`sessionStorage` globals during SSR to fix Node 25+ Web Storage API conflicts. It is loaded via `NODE_OPTIONS='--require ./node-compat.cjs'` in all npm scripts.

## Code Style

- Use comments sparingly. Only add comments for complex or non-obvious code.

## Tech Stack

- Next.js 15 (App Router, Turbopack), React 19, TypeScript
- Tailwind CSS v4, shadcn/ui components (`src/components/ui/`)
- Prisma + SQLite, Vercel AI SDK + Anthropic Claude
- Vitest + React Testing Library + jsdom
- Path alias: `@/*` maps to `./src/*`
