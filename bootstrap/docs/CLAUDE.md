# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This directory is the VPS home for **learn.theemployeefactory.com**, serving an [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) LMS deployment — an AI-powered interactive classroom platform that generates slides, quizzes, and multi-agent roundtable discussions from topics or documents.

## Directory Layout

```
/home/learn.theemployeefactory.com/
├── openmaic_src/        # Next.js 16 source — active development
├── old_project_backup/  # Legacy static website (public_html + Vite source)
├── logs/                # Nginx access/error logs for this vhost
├── .env                 # Azure AI credential overrides (parent-level)
└── .envelope            # Master credentials vault — NEVER COMMIT
```

## Deployment Architecture

- **CyberPanel** manages the web server and vhost for `learn.theemployeefactory.com`
- **Live app** runs from `/home/learn.theemployeefactory.com/openmaic_src/` (built and started via `pnpm start`)
- **Deploying a new build**: `cd openmaic_src && pnpm build && pnpm start`

## Development Commands

All commands run from `openmaic_src/` using **pnpm 10** (Node >= 20.9.0 required).

```bash
cd openmaic_src

pnpm install          # Install deps (also builds packages/mathml2omml and packages/pptxgenjs)
pnpm dev              # Dev server on http://localhost:3000
pnpm build            # Production build
pnpm start            # Start production server (after build)

pnpm format           # Format with Prettier
pnpm lint             # ESLint (add --fix to auto-fix)
npx tsc --noEmit      # TypeScript type check
pnpm check:i18n-keys  # Validate i18n key alignment across all locale files

pnpm test             # Unit tests (Vitest)
pnpm test:e2e         # E2E tests (Playwright, expects dev server on :3002)
```

## AI Provider Configuration

- Claude is accessed via an **Azure Foundry endpoint** (not `api.anthropic.com`):
  `ANTHROPIC_BASE_URL=https://ai-sambhatt3210ai899661109114.services.ai.azure.com/anthropic/v1`
- Azure OpenAI is also configured alongside Google API and OpenRouter/Grok
- App-level keys live in `openmaic_src/.env.local`; root-level `.env` holds Azure overrides
- Copy `.env.example` → `.env.local` to set up a fresh instance; at least one provider key is required

## Application Architecture

The app is built with **Next.js 16 App Router**, **React 19**, **TypeScript 5**, and **Tailwind CSS 4**.

### Key layers

| Layer | Path | Purpose |
|---|---|---|
| Pages & API routes | `app/` | Next.js App Router; API routes for generation, chat, media |
| UI components | `components/` | Whiteboard, roundtable, scene renderers, settings |
| Core logic | `lib/` | AI, orchestration, generation, export, import, audio, quiz |
| Prompt templates | `lib/prompts/` | Markdown + YAML frontmatter; hot-reloaded via `import.meta.glob` |
| Client state | `lib/store/` | Zustand stores (settings, stage, canvas, media) persisted to IndexedDB via Dexie |
| Workspace packages | `packages/` | Forks of `mathml2omml` and `pptxgenjs` with custom build steps |

### Multi-agent orchestration

- **Director Graph** (`lib/orchestration/director-graph.ts`) — LangGraph state machine managing which agent speaks next, whiteboard actions, and turn summaries
- **Generation pipeline** (`lib/generation/`) — converts a topic into outline → scenes → whiteboard actions
- All LLM calls route through `lib/ai/llm.ts` (`callLLM` / `streamLLM`) backed by Vercel AI SDK with 14+ provider adapters

### i18n

All user-facing strings must use i18next keys (`lib/i18n/locales/{lang}.json`). Adding a key requires updating all language files; `pnpm check:i18n-keys` enforces this in CI.
