# CLAUDE.md

This file provides guidance to Claude Code when working with the Sessions codebase.

## Overview

Sessions is a macOS desktop app that captures your work and turns it into structured AI-powered insights. Built with Tauri v2 (Rust) + React 19 + TypeScript + Vite.

**Two capture modes:**
1. **Quick Capture** — Type/paste text + files, get an AI summary with extracted tasks and notes
2. **Session Recording** — Record screen + audio while working, get a comprehensive AI summary

**Core principle:** Minimal UI, content that wows. All AI processing runs off the main thread via Web Workers.

## Development Commands

```bash
npm run dev              # Vite dev server (frontend only, port 5173)
npm run tauri:dev        # Full Tauri app (frontend + native Rust backend)
npm run build            # TypeScript check + Vite production build

npx tsc --noEmit         # TypeScript type check
npx eslint "src/**/*.{ts,tsx}"  # Lint (0 errors expected, ~17 advisory warnings OK)
npx vitest run           # Run all tests (81 tests, 6 suites)
npm run test:coverage    # Coverage report

npm run tauri:build      # Production desktop build (.dmg / .app)
```

**Important:** Use the glob pattern `"src/**/*.{ts,tsx}"` for eslint, not `eslint src/`.

## Architecture

### Tech Stack
- **Frontend:** React 19 + TypeScript + Vite
- **Desktop:** Tauri v2 (Rust backend for screen/audio capture, HTTP proxy, SQLite)
- **AI Pipelines:** [BaleyBots SDK](vendor/baleybots/) (vendored submodule) with BAL DSL
- **Styling:** Tailwind CSS v4
- **Animation:** Framer Motion
- **Icons:** Lucide React
- **Storage:** SQLite (WAL mode) via `@tauri-apps/plugin-sql`
- **Secrets:** Tauri Store plugin for encrypted API key storage

### Directory Structure

```
src/
├── components/              # React UI components
│   ├── Home.tsx             # Landing screen with capture cards + recent sessions
│   ├── QuickCapture.tsx     # Text/file capture → AI processing via worker
│   ├── SessionRecording.tsx # Active recording UI, timer, live insights, final summary
│   ├── SummaryView.tsx      # ★ The star — AI summary display + chat interface
│   ├── History.tsx          # Timeline view with search and grouping
│   ├── Settings.tsx         # API key configuration (Anthropic + OpenAI)
│   ├── CommandPalette.tsx   # ⌘K quick actions
│   ├── WelcomeModal.tsx     # First-run onboarding
│   ├── SessionSetup.tsx     # Screen/mic picker before recording
│   ├── SessionTimer.tsx     # Recording timer + title editing
│   ├── LiveDashboard.tsx    # Real-time session stats during recording
│   ├── LiveTranscript.tsx   # Live audio transcription display
│   ├── InsightsPanel.tsx    # AI insights generated during recording
│   ├── Toast.tsx            # Toast notification system + ToastProvider
│   ├── ErrorBoundary.tsx    # Error recovery wrapper
│   └── ...                  # Supporting UI (Tooltip, ConfirmDialog, etc.)
│
├── services/
│   ├── bots/                # AI pipeline orchestration (BaleyBots)
│   │   ├── config.ts        # API key management, BaleyBots init, Tauri proxy config
│   │   ├── types.ts         # Zod schemas for bot outputs (ActivityDetection, RollingSummary, etc.)
│   │   ├── input-builders.ts    # Format multimodal inputs for bot pipelines
│   │   ├── index.ts         # Public API barrel exports
│   │   └── pipelines/
│   │       ├── definitions.ts   # BAL bot definitions (6 bots)
│   │       ├── factory.ts       # Lazy pipeline compilation with caching
│   │       └── index.ts
│   │
│   ├── worker/              # Web Worker for off-main-thread AI processing
│   │   ├── ai-worker.ts         # Worker implementation (runs in Worker context)
│   │   ├── ai-worker-client.ts  # Main thread client (singleton: aiWorker)
│   │   ├── types.ts             # Typed message protocol (WorkerMessage / WorkerResponse)
│   │   ├── worker-state.ts      # State machine (CREATED → INITIALIZING → INITIALIZED ↔ ERROR)
│   │   ├── message-queue.ts     # Sequential message processing
│   │   ├── request-manager.ts   # Request/response correlation
│   │   └── index.ts
│   │
│   ├── session-bridge.ts    # Coordinator: worker ↔ database ↔ UI events
│   ├── recording.ts         # Tauri IPC for screen/audio capture
│   ├── database.ts          # SQLite abstraction (sessions, screenshots, audio, insights, chat)
│   ├── secure-storage.ts    # Encrypted API key storage (Tauri Store plugin)
│   ├── smart-capture.ts     # Activity-aware screenshot timing (10-60s adaptive)
│   ├── storage.ts           # localStorage for client-side cache
│   └── event-emitter.ts     # Typed event bus for cross-service communication
│
├── hooks/
│   ├── useSessionChat.ts          # Chat state management via worker
│   ├── useKeyboardShortcuts.ts    # Global shortcuts (⌘N, ⇧⌘N, ⌘K, ⌘H)
│   └── useSessionIntelligence.ts  # Session analysis & insight generation
│
├── context/
│   └── AppContext.tsx        # Global state (useReducer) + database persistence
│
├── types/
│   ├── index.ts             # Core types (Session, Summary, Task, Note, Attachment)
│   └── database.ts          # Database row types (DbSession, DbScreenshot, etc.)
│
├── utils/
│   ├── logger.ts            # Dev-gated logger — use instead of console.*
│   ├── id.ts                # UUID generation
│   └── validate.ts          # Zod validation helpers
│
├── shims/                   # Browser shims for Node.js modules (BaleyBots compat)
├── test/
│   ├── setup.ts             # Vitest setup (Tauri mocks, Worker mocks)
│   └── mocks/
│       ├── baleybots.ts     # BaleyBots pipeline mocks
│       └── worker.ts        # MockWorker with _simulateMessage/_simulateError
│
├── App.tsx                  # View router (state machine: home|summary|history|capture|recording|settings)
└── main.tsx                 # React bootstrap

src-tauri/
├── src/
│   ├── lib.rs               # Tauri commands: screenshot capture, audio devices, permissions
│   ├── activity_monitor.rs  # macOS activity tracking
│   ├── audio_capture.rs     # Audio recording via cpal
│   └── http_proxy.rs        # HTTP proxy for CORS bypass (API calls from main thread)
└── Cargo.toml

vendor/baleybots/            # BaleyBots SDK (Git submodule)
```

## AI Pipeline Architecture

All AI processing runs in a **Web Worker** — never on the main thread. Components interact with AI exclusively through `aiWorker` (the worker client singleton).

### Data Flow

```
Component (e.g., QuickCapture.tsx)
  → aiWorker.processCapture(text, attachments)     # main thread client
    → postMessage to Web Worker                     # typed message
      → ai-worker.ts handles message               # in Worker context
        → pipeline = Pipeline.from(BAL_DEFINITION)  # compile BAL → pipeline
        → result = pipeline.process(input)          # call Claude API
      → postMessage response back
    → Promise resolves with result
  → Component displays summary
```

### Adding a New Bot

1. **Define the bot** in `src/services/bots/pipelines/definitions.ts` using BAL syntax:
   ```typescript
   export const BOT_DEFINITIONS = {
     // ... existing bots
     myNewBot: `
       my_new_bot {
         "goal": "What the bot should do.\\nBe specific about output format.",
         "output": {
           "field1": "string",
           "field2": "array"
         }
       }
       chain { my_new_bot }
     `,
   };
   ```

2. **Add Zod schema + TypeScript type** in `src/services/bots/types.ts`:
   ```typescript
   export const MyNewBotSchema = z.object({
     field1: z.string(),
     field2: z.array(z.string()),
   });
   export type MyNewBotResult = z.infer<typeof MyNewBotSchema>;
   ```

3. **Add pipeline factory** in `src/services/bots/pipelines/factory.ts`:
   ```typescript
   let myNewBotPipeline: Pipeline | null = null;
   export function createMyNewBotPipeline(): Pipeline {
     if (!myNewBotPipeline) {
       myNewBotPipeline = compilePipeline('my-new-bot', BOT_DEFINITIONS.myNewBot, MODELS.default);
     }
     return myNewBotPipeline;
   }
   ```
   Add `myNewBotPipeline = null` to `resetPipelines()`.

4. **Add input builder** in `src/services/bots/input-builders.ts`:
   ```typescript
   export function buildMyNewBotInput(data: SomeType): string | Content[] {
     return JSON.stringify({ data });
   }
   ```

5. **Add worker message types** in `src/services/worker/types.ts` (request + response).

6. **Add worker handler** in `src/services/worker/ai-worker.ts` — follow the existing pattern: check readiness → transition to PROCESSING → build input → `withRetry(pipeline.process())` → send response → transition to INITIALIZED.

7. **Add client method** in `src/services/worker/ai-worker-client.ts` — follow the existing Promise-based pattern with correlation ID and timeout.

8. **Export** from barrel files (`pipelines/index.ts`, `bots/index.ts`, `worker/index.ts`).

### BAL Syntax Reference

The BaleyBots DSL is used to define bot pipelines declaratively. See the full reference at `vendor/baleybots/typescript/packages/tools/.claude/skills/baleybots-dsl/SKILL.md`.

Key patterns used in this project:
- **Entity definition:** `name { "goal": "...", "output": { ... } }`
- **Sequential chain:** `chain { entity }` (single bot, sequential execution)
- **Output types:** `"string"`, `"number"`, `"boolean"`, `"array"`, `"object"` (exact type names only)
- **Newlines in goals:** Use `\\n` (BAL parser doesn't support multi-line strings in JSON syntax)
- **Model:** Set per-pipeline in `factory.ts`, currently `claude-sonnet-4-20250514`

### Current Bots

| Bot | Purpose | Used By |
|-----|---------|---------|
| `activityDetector` | Analyze screenshots for app/context/activity | Worker: screenshot analysis |
| `summarizer` | Maintain rolling session summary | Worker: periodic summary updates |
| `analysisController` | Decide ambient vs deep analysis mode | Worker: mode checks |
| `qaBot` | Answer questions about sessions | Worker: chat messages |
| `finalSummary` | Generate comprehensive end-of-session summary | Worker: session end |
| `capture` | Process quick capture text + files | Worker: capture processing |

## Key Patterns

### Logging
Use `logger` from `src/utils/logger.ts` — never use `console.*` directly (enforced by ESLint `no-console` rule).

```typescript
import { logger } from '../utils/logger';
logger.debug('Dev-only message');
logger.info('Important flow event');
logger.warn('Something unexpected');
logger.error('Error occurred:', error);
```

### Tauri Commands (Rust ↔ TypeScript)
All Tauri commands return `Result<T, String>` on the Rust side. User-facing errors are sanitized.

```typescript
import { invoke } from '@tauri-apps/api/core';
const screenshot = await invoke<string>('capture_screenshot', { screenId });
```

### Secure Storage
API keys are stored encrypted via Tauri Store plugin. Never store secrets in localStorage.

```typescript
import { getSecureItem, setSecureItem } from './services/secure-storage';
const key = await getSecureItem('sessions_api_key');
```

### Worker Communication
Components never call BaleyBots pipelines directly. Always go through the worker client:

```typescript
import { aiWorker } from './services/worker/ai-worker-client';

// Worker handles lifecycle automatically
const result = await aiWorker.processCapture(text, attachments);
const summary = await aiWorker.generateFinalSummary({ ... });
const chatReply = await aiWorker.chat(sessionId, question, context);
```

### Navigation
App.tsx uses a view state machine — no router library. Views: `home`, `summary`, `history`, `capture`, `recording`, `settings`.

```typescript
const [view, setView] = useState<View>('home');
```

Components are lazy-loaded via `React.lazy()` for route-level code splitting.

### React 19 Notes
- `useRef()` requires an initial value: `useRef<T>(null)` not `useRef<T>()`
- React Compiler lint rules (`set-state-in-effect`, `immutability`) are advisory, not bugs

## Testing

Tests live alongside their source in `__tests__/` directories. Mocks are in `src/test/mocks/`.

```bash
npx vitest run                    # All tests (81 tests, 6 suites)
npx vitest run --reporter=verbose # Detailed output
npx vitest run src/services/worker  # Run specific suite
```

### Test Mocks

- **`src/test/mocks/baleybots.ts`** — Mock pipeline factories, input builders, and response objects
- **`src/test/mocks/worker.ts`** — MockWorker with `_simulateMessage()` and `_simulateError()` helpers
- **`src/test/setup.ts`** — Global setup: Tauri API mocks, secure storage mocks, Worker constructor mock

### Writing Tests

Follow existing patterns in `src/services/worker/__tests__/`. Tests use Vitest + jsdom. The MockWorker intercepts `postMessage` calls and provides helpers to simulate responses:

```typescript
const worker = new MockWorker();
worker._simulateMessage({ type: 'ready', timestamp: Date.now() });
```

## Design Principles

1. **Notion-like minimalism** — Clean, lots of whitespace, content-first
2. **Content is the star** — Summaries should wow the user
3. **No feature creep** — We don't build task management or note-taking
4. **AI-first** — Every interaction enhanced by AI
5. **Local-first** — Data on your machine, AI API calls are the only network traffic
6. **Off-main-thread AI** — All pipeline execution in Web Worker, UI never blocks

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` | Open command palette |
| `⌘N` | New capture |
| `⇧⌘N` | Start session |
| `⌘H` | Go home |

## Gotchas

- ESLint must use glob: `eslint "src/**/*.{ts,tsx}"` — `eslint src/` fails
- BaleyBots vendor dir has Node.js imports (`fs`, `path`, `child_process`) that Vite externalizes — this is expected
- `@typescript-eslint/no-unused-vars` needs `caughtErrorsIgnorePattern` for catch clauses
- Workers use native `fetch` with `'anthropic-dangerous-direct-browser-access': 'true'` header (no Tauri proxy in Worker context)
- The `isTauri()` check (from `services/recording.ts`) guards Tauri-only features for browser dev mode
