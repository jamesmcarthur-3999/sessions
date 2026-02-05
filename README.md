# Sessions

> Record your work. Get AI summaries. Share with your tools.

Sessions is a desktop app that captures your work and turns it into structured, AI-powered insights. Built with **Tauri v2** (Rust) and **React 19** (TypeScript).

## What It Does

**Two capture modes:**

1. **Quick Capture** - Type or paste something, get an AI-generated summary with extracted tasks and notes
2. **Session Recording** - Record your screen + audio while working, then get a comprehensive AI summary of what you accomplished

**AI is the integration layer.** Summaries are the star of the show. Instead of building yet another task manager or note-taking app, Sessions uses AI (Claude) to analyze your work and MCP (Model Context Protocol) to connect to the tools you already use.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion
- **Desktop:** Tauri v2 with Rust backend
- **AI:** Claude API via [Baleybots](https://github.com/baleybots/baleybots) pipeline framework
- **Capture:** Screen recording (ScreenCaptureKit), audio recording (Core Audio via cpal), activity monitoring
- **Storage:** IndexedDB (browser) + Tauri File System (desktop), dual-adapter pattern

## Features

- **AI-Powered Summaries** - Claude analyzes screenshots, audio transcripts, and text to generate structured summaries
- **Task & Note Extraction** - Automatically pulls actionable items from your work sessions
- **Session Chat** - Ask questions about your recorded sessions, request actions via MCP integrations
- **Keyboard-First** - Command palette (`Cmd+K`), global shortcuts for common actions
- **Local-First** - Your data stays on your machine; AI API calls are the only network traffic
- **Bot Pipeline Architecture** - Modular AI processing pipelines for capture analysis, summarization, and enrichment
- **Worker Thread Processing** - Heavy AI operations run off the main thread for responsive UI

## Architecture

```
src/
├── components/          # React components
│   ├── Home.tsx         # Start screen with session/capture cards
│   ├── QuickCapture.tsx # Text/file capture with AI processing
│   ├── SessionRecording.tsx  # Timer-based session recording
│   ├── SummaryView.tsx  # AI summaries with chat interface
│   └── CommandPalette.tsx    # Cmd+K quick actions
├── services/
│   ├── ai.ts            # Claude API integration
│   ├── bots/            # AI bot pipeline system
│   │   ├── pipelines/   # Modular processing pipelines
│   │   └── config.ts    # Bot configuration
│   ├── worker/          # Off-thread AI processing
│   ├── database.ts      # Session/capture persistence
│   └── recording.ts     # Screen + audio capture coordination
├── hooks/               # Custom React hooks
├── types/               # TypeScript type definitions
└── test/                # Test utilities

src-tauri/
├── src/
│   ├── lib.rs               # Tauri app setup + commands
│   ├── activity_monitor.rs  # macOS activity tracking
│   ├── audio_capture.rs     # Audio recording (cpal)
│   ├── http_proxy.rs        # HTTP proxy for API calls
│   └── ...
└── Cargo.toml
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- A Claude API key from [console.anthropic.com](https://console.anthropic.com/settings/keys)

### Setup

```bash
# Clone the repo (including submodules)
git clone --recurse-submodules https://github.com/jamesmcarthur-3999/sessions.git
cd sessions

# Install dependencies
npm install

# Start development (frontend only)
npm run dev

# Start full Tauri development (frontend + native)
npm run tauri dev
```

### Commands

```bash
npm run dev           # Vite dev server
npm run tauri dev     # Full Tauri app (dev mode)
npm run build         # TypeScript check + Vite build
npm run tauri build   # Production desktop build
npm run test          # Run tests (vitest)
npm run test:run      # Run tests once
npm run lint          # ESLint
```

### API Key

1. Get a key from [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. Open Settings in the app (gear icon)
3. Paste your key and save

Without an API key, the app uses smart mock responses for development.

## Design Principles

1. **Minimal UI, maximal content** - Clean, Notion-like simplicity
2. **No feature creep** - Capture and summarize, then integrate with existing tools via MCP
3. **AI-first** - Every interaction enhanced by Claude
4. **Local-first** - Data on your machine, API calls only for AI processing

## License

MIT
