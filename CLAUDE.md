# CLAUDE.md

This file provides guidance to Claude Code when working with the Sessions codebase.

## Overview

Sessions is a focused app that captures your work and turns it into structured AI-powered insights.

**Two capture modes:**
1. **Quick Capture** - Type/paste something → AI summary with tasks and notes
2. **Session Recording** - Record screen + audio → comprehensive summary

**Core principle:** Minimal UI, content that wows. AI is the integration layer via MCPs.

## Development Commands

```bash
# Start development (frontend only)
npm run dev

# Start Tauri development (full app)
npm run tauri dev

# Type check
npx tsc --noEmit

# Build for production
npm run tauri build
```

## Architecture

### Tech Stack
- **Frontend**: React 19 + TypeScript + Vite
- **Desktop**: Tauri v2 (Rust backend)
- **Styling**: Tailwind CSS v4
- **Animation**: Framer Motion (when needed)
- **Icons**: Lucide React

### Directory Structure
```
src/
├── components/
│   ├── Home.tsx           # Start screen - two action cards
│   ├── SummaryView.tsx    # The star - beautiful AI summaries
│   └── History.tsx        # Timeline of past sessions
├── context/               # Minimal context (1-2 max)
├── services/              # AI, storage, MCP client
└── types/
    └── index.ts           # Simple, flat types
```

### Design Principles
1. **Notion-like minimalism** - Clean, lots of whitespace
2. **Content is the star** - Summaries should wow
3. **No feature creep** - We don't build task management or note-taking
4. **AI-first** - Every interaction enhanced by AI
5. **Local-first** - Data on your machine, AI calls only network traffic

## Data Model

```typescript
interface Session {
  id: string;
  type: 'session' | 'capture';
  title: string;
  createdAt: string;
  duration?: number;
  summary?: Summary;
}

interface Summary {
  text: string;
  tasks: Task[];
  notes: Note[];
}
```

Keep types simple and flat. No over-engineering.

## Roadmap

See `docs/PLAN.md` for the full implementation plan.

**Phase 1:** Quick capture → AI summary (MVP)
**Phase 2:** Session recording (pull Rust code from Taskerino)
**Phase 3:** AI chat + MCP integrations
**Phase 4:** Polish and keyboard shortcuts
