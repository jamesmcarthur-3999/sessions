# Sessions

> Record your work. Get AI summaries. Share with your tools.

Sessions is a macOS desktop app that captures your work and turns it into structured, AI-powered insights. Built with **Tauri v2** (Rust) and **React 19** (TypeScript).

## What It Does

**Two capture modes:**

1. **Quick Capture** — Type or paste something, get an AI-generated summary with extracted tasks and notes
2. **Session Recording** — Record your screen + audio while working, then get a comprehensive AI summary of what you accomplished

**AI is the integration layer.** Summaries are the star of the show. Instead of building yet another task manager or note-taking app, Sessions uses AI (Claude) to analyze your work and MCP (Model Context Protocol) to connect to the tools you already use.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion
- **Desktop:** Tauri v2 with Rust backend
- **AI:** Claude API via [BaleyBots](https://github.com/baleybots/baleybots) pipeline framework (vendored)
- **Capture:** Screen recording (ScreenCaptureKit), audio recording (Core Audio via cpal)
- **Storage:** SQLite (WAL mode) via Tauri plugin, encrypted secrets via Tauri Store
- **AI Processing:** Web Worker architecture — all pipeline execution off the main thread

## Features

- **AI-Powered Summaries** — Claude analyzes screenshots, audio transcripts, and text to generate structured summaries
- **Task & Note Extraction** — Automatically pulls actionable items from your work sessions
- **Session Chat** — Ask questions about your recorded sessions
- **Live Session Intelligence** — Real-time insights, rolling summary, and activity detection during recording
- **Adaptive Capture** — Activity-aware screenshot timing (10-60s intervals based on what you're doing)
- **Keyboard-First** — Command palette (`Cmd+K`), global shortcuts for common actions
- **Local-First** — Your data stays on your machine; AI API calls are the only network traffic
- **Worker Thread Processing** — Heavy AI operations run off the main thread for responsive UI

## Architecture

```
src/
├── components/             # React UI (lazy-loaded routes)
│   ├── Home.tsx            # Landing screen with session/capture cards
│   ├── QuickCapture.tsx    # Text/file capture → AI processing
│   ├── SessionRecording.tsx    # Timer-based recording with live insights
│   ├── SummaryView.tsx     # ★ AI summary display + chat interface
│   ├── History.tsx         # Timeline with search
│   ├── Settings.tsx        # API key configuration
│   └── CommandPalette.tsx  # Cmd+K quick actions
├── services/
│   ├── bots/               # BaleyBots AI pipeline definitions & factories
│   │   └── pipelines/      # BAL bot definitions, compiled pipeline cache
│   ├── worker/             # Web Worker for off-main-thread AI processing
│   │   ├── ai-worker.ts        # Worker implementation
│   │   └── ai-worker-client.ts # Main thread client (singleton)
│   ├── session-bridge.ts   # Worker ↔ database ↔ UI coordinator
│   ├── database.ts         # SQLite persistence layer
│   ├── recording.ts        # Screen + audio capture (Tauri IPC)
│   └── secure-storage.ts   # Encrypted API key storage
├── hooks/                  # Custom React hooks
├── context/                # AppContext (global state + database persistence)
├── types/                  # TypeScript type definitions
└── test/                   # Test setup + mocks

src-tauri/
├── src/
│   ├── lib.rs              # Tauri commands (screenshot, audio, permissions)
│   ├── audio_capture.rs    # Audio recording (cpal)
│   ├── http_proxy.rs       # HTTP proxy for CORS bypass
│   └── activity_monitor.rs # macOS activity tracking
└── Cargo.toml

vendor/baleybots/           # BaleyBots SDK (Git submodule)
```

### AI Pipeline Flow

All AI processing runs in a Web Worker to keep the UI responsive:

```
User action (capture text, end recording, send chat message)
  → aiWorker client sends typed message to Worker
    → Worker compiles BAL definition → Pipeline
    → Pipeline calls Claude API with structured input
    → Worker sends typed response back
  → Component receives result and renders
```

Six bot pipelines handle different tasks: activity detection, rolling summarization, analysis mode control, Q&A chat, final summary generation, and quick capture processing.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- A Claude API key from [console.anthropic.com](https://console.anthropic.com/settings/keys)

### Setup

```bash
# Clone the repo (including BaleyBots submodule)
git clone --recurse-submodules https://github.com/jamesmcarthur-3999/sessions.git
cd sessions

# Install dependencies
npm install

# Start development (frontend only — no native features)
npm run dev

# Start full Tauri development (frontend + Rust backend)
npm run tauri:dev
```

### Commands

```bash
npm run dev              # Vite dev server (port 5173)
npm run tauri:dev        # Full Tauri app (dev mode)
npm run build            # TypeScript check + Vite production build
npm run tauri:build      # Production desktop build (.dmg / .app)

npx tsc --noEmit         # Type check
npx eslint "src/**/*.{ts,tsx}"  # Lint
npx vitest run           # Run tests (81 tests, 6 suites)
npm run test:coverage    # Coverage report
```

### API Key

1. Get a key from [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. Open Settings in the app (gear icon)
3. Paste your key and save

API keys are stored encrypted via Tauri's secure storage plugin. Without an API key, AI features are unavailable (the app will show appropriate messaging).

### BaleyBots Submodule

The BaleyBots SDK is vendored as a Git submodule at `vendor/baleybots/`. It provides the `Pipeline.from()` API for compiling BAL (BaleyBots Assembly Language) definitions into executable AI pipelines.

```bash
# Ensure submodule is present (runs automatically on npm run dev/build)
npm run baleybots:ensure

# Update to latest
npm run baleybots:update
```

Bot definitions live in `src/services/bots/pipelines/definitions.ts` using BAL syntax. See `vendor/baleybots/typescript/packages/tools/.claude/skills/baleybots-dsl/SKILL.md` for the full DSL reference.

## Design Principles

1. **Minimal UI, maximal content** — Clean, Notion-like simplicity
2. **No feature creep** — Capture and summarize, then integrate with existing tools via MCP
3. **AI-first** — Every interaction enhanced by Claude
4. **Local-first** — Data on your machine, API calls only for AI processing
5. **Off-main-thread** — All AI pipeline execution in a Web Worker

## License

MIT
