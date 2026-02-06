# Sessions - Product Plan

> Record your work. Get AI summaries. Share with your tools.

## Vision

Sessions is a focused app that does one thing well: capture your work and turn it into structured insights.

**Two ways to capture:**
1. **Quick Capture** - Type/paste/attach something, get an AI summary with extracted tasks and notes
2. **Session Recording** - Record your screen + audio while working, get a comprehensive summary

**AI is central:**
- Summaries are the star of the show
- AI chat to take actions ("send this to Linear", "add to Notion")
- MCPs as the integration layer - AI uses tools to connect to your existing apps

## Core Principles

1. **Minimal UI, maximal content** - Notion-like simplicity, summaries that wow
2. **No feature creep** - We don't build task management or note-taking, we integrate with tools that do
3. **AI-first** - Every interaction is enhanced by AI
4. **Local-first** - Your data stays on your machine, AI calls are the only network traffic

## Screens

### 1. Home
The starting point. Clean and simple.

```
┌─────────────────────────────────────────────┐
│                                             │
│           Good afternoon, James             │
│                                             │
│    ┌─────────────────────────────────┐      │
│    │                                 │      │
│    │      Start a Session           │      │
│    │      Record your work          │      │
│    │                                 │      │
│    └─────────────────────────────────┘      │
│                                             │
│    ┌─────────────────────────────────┐      │
│    │                                 │      │
│    │      Quick Capture             │      │
│    │      Paste or type something   │      │
│    │                                 │      │
│    └─────────────────────────────────┘      │
│                                             │
│  ─────────────────────────────────────────  │
│                                             │
│  Recent                                     │
│                                             │
│  • Session: API Integration Work (2h ago)   │
│  • Capture: Meeting notes from... (5h ago)  │
│  • Session: Bug fixing sprint (yesterday)   │
│                                             │
└─────────────────────────────────────────────┘
```

### 2. Session Recording (Active)
Minimal overlay while recording.

```
┌─────────────────────────────────────────────┐
│                                             │
│          Recording: API Integration         │
│          ●  02:34:15                        │
│                                             │
│          [Pause]  [End Session]             │
│                                             │
└─────────────────────────────────────────────┘
```

### 3. Summary View
The star of the show. Beautiful, content-rich summaries.

```
┌─────────────────────────────────────────────┐
│  ← Back                                     │
│                                             │
│  API Integration Work                       │
│  Session • 2 hours 34 minutes • Today       │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │                                     │    │
│  │  SUMMARY                            │    │
│  │                                     │    │
│  │  You worked on integrating the      │    │
│  │  Stripe API for payment processing. │    │
│  │  Key accomplishments:               │    │
│  │                                     │    │
│  │  • Set up webhook endpoints         │    │
│  │  • Implemented subscription logic   │    │
│  │  • Fixed edge case in refunds       │    │
│  │                                     │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  TASKS EXTRACTED                            │
│  ☐ Add retry logic for failed webhooks      │
│  ☐ Write tests for subscription edge cases  │
│  ☐ Update API documentation                 │
│                                             │
│  NOTES                                      │
│  • Stripe webhook signing secret in .env    │
│  • Need to handle currency conversion       │
│                                             │
│  ─────────────────────────────────────────  │
│                                             │
│  💬 Ask AI to take action...                │
│                                             │
│  "Create a Linear ticket for the webhook    │
│   retry logic"                              │
│                                             │
└─────────────────────────────────────────────┘
```

### 4. History
Timeline of all your sessions and captures.

```
┌─────────────────────────────────────────────┐
│  Sessions     History                       │
│                                             │
│  Today                                      │
│  ├─ API Integration Work (Session, 2h)      │
│  └─ Meeting notes capture (Capture)         │
│                                             │
│  Yesterday                                  │
│  ├─ Bug fixing sprint (Session, 4h)         │
│  └─ Research notes (Capture)                │
│                                             │
│  Jan 29                                     │
│  └─ Feature planning (Session, 1h)          │
│                                             │
└─────────────────────────────────────────────┘
```

## Technical Architecture

### Frontend (React + TypeScript)
```
src/
├── components/
│   ├── Home.tsx              # Start screen
│   ├── SessionRecording.tsx  # Active session UI
│   ├── SummaryView.tsx       # The star - summary display
│   ├── History.tsx           # Past sessions/captures
│   ├── Chat.tsx              # AI chat for actions
│   └── ui/                   # Minimal UI components
├── context/
│   ├── AppContext.tsx        # Single, simple context
│   └── ThemeContext.tsx      # Light/dark mode
├── services/
│   ├── bots/                  # BaleyBots AI pipeline definitions
│   ├── worker/                # AI Worker (off-main-thread processing)
│   ├── storage.ts             # Local storage
│   └── mcp.ts                 # MCP client for integrations
└── types/
    └── index.ts              # Simple, flat types
```

### Backend (Tauri/Rust)
Pull from Taskerino:
- Screen capture
- Audio recording
- Video recording
- AI API calls (Claude, OpenAI)
- Secure storage

### Data Model (Simple)
```typescript
interface Session {
  id: string;
  type: 'session' | 'capture';
  title: string;
  createdAt: string;
  duration?: number; // seconds, for sessions

  // Raw data
  screenshots?: Screenshot[];
  audioSegments?: AudioSegment[];
  captureText?: string;
  attachments?: Attachment[];

  // AI output
  summary?: Summary;
}

interface Summary {
  text: string;
  tasks: Task[];
  notes: Note[];
  generatedAt: string;
}

interface Task {
  id: string;
  title: string;
  completed: boolean;
}

interface Note {
  id: string;
  content: string;
}
```

## MCP Integrations (Phase 2)

Instead of export buttons, AI uses MCPs:

```
User: "Create a Linear ticket for the webhook retry"
AI: [uses Linear MCP] → "Done! Created LIN-234: Add retry logic..."

User: "Add these notes to my Notion workspace"
AI: [uses Notion MCP] → "Added to your Development Notes page"
```

**MCPs to support:**
- Linear (tasks/issues)
- Notion (notes/docs)
- Todoist (tasks)
- Slack (sharing)
- GitHub (issues)

## Implementation Phases

### Phase 1: Core Loop (MVP)
- [ ] Home screen with two buttons
- [ ] Quick capture → text input → AI summary
- [ ] Display summary with tasks/notes
- [ ] Basic history view
- [ ] Local storage

### Phase 2: Session Recording
- [ ] Pull Rust recording code from Taskerino
- [ ] Session start/pause/end
- [ ] Screenshot capture during session
- [ ] Audio capture during session
- [ ] Session → AI summary

### Phase 3: AI Chat + MCPs
- [ ] Chat interface in summary view
- [ ] MCP client integration
- [ ] Linear MCP
- [ ] Notion MCP
- [ ] Natural language → MCP actions

### Phase 4: Polish
- [ ] Beautiful summary cards
- [ ] Smooth animations
- [ ] Keyboard shortcuts
- [ ] Menu bar quick access

## Success Metrics

1. **Time to first summary** - How fast from capture to insight?
2. **Summary quality** - Are the AI summaries useful?
3. **Action completion** - Do users take actions via AI chat?
4. **Daily usage** - Are people recording sessions regularly?

---

*Built on the lessons from Taskerino. Simpler. Focused. AI-first.*
