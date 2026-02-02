# Intelligent Session Recording - Design Document

> **For Claude:** This is a design document. Implementation will follow via a separate planning phase.

**Goal:** Transform session recording from a passive timer into an intelligent, responsive experience that feels like magic.

**Date:** 2026-02-02

---

## Design Philosophy

- **Minimal by default** - The recording view stays focused and calm
- **Depth when you want it** - Rich intelligence available on demand
- **Ambient feedback** - You *feel* the session state, not read it
- **Real-time intelligence** - AI analysis streams as the session unfolds

---

## Visual Design

### The Peripheral Glow

The edges of the recording screen have a subtle, ambient glow that communicates session state without demanding attention.

**Audio Response:**
- Glow brightness and movement respond to voice/audio input
- Subtle breathing effect when audio is detected
- Creates "the room is alive" feeling

**Analysis Intensity:**
- **Warm amber** = Ambient/low analysis mode
- **Cool blue/white** = Deep/high analysis mode
- Color temperature shifts smoothly when mode changes
- Subliminal communication - you feel intensity changes

### Capture Heartbeat

When a screenshot is captured:
- Brief golden ripple or flash from the glow
- Confirms capture happened without interrupting flow
- Subtle enough to ignore, noticeable enough to reassure

---

## Information Architecture

### Layer 1: Always Visible (Ambient)

- Large, centered timer (current design)
- Peripheral glow (audio + analysis state)
- Minimal capture heartbeat
- Session title (editable)

### Layer 2: Editorial Marginalia

Cards appear in the right margin, styled like elegant editorial annotations.

**Card Types:**

1. **Rolling Summary (Living Card)**
   - Always present in the margin
   - 2-3 sentences that evolve as session progresses
   - Text subtly rewrites as understanding deepens
   - Has subtle "Ask anything..." prompt at bottom

2. **Ephemeral Insight Cards**
   - Drift in when something notable happens
   - "You switched to VS Code"
   - "Key moment: discussed API architecture"
   - Fade after a few seconds
   - Stack vertically if multiple appear

3. **Pinned Cards**
   - User can pin any ephemeral card
   - Stays visible in margin
   - Useful for insights you want to reference

**Visual Treatment:**
- Paper-like texture, subtle shadows
- Source Serif typography for editorial feel
- Gold accent bar on left edge (AI-generated content)
- Fade in softly, linger, dissolve gracefully

### Layer 3: Intelligence Panel (On Demand)

Triggered by typing in the Rolling Summary card. The card expands to take the right third of the screen.

**Layout (top to bottom):**

```
┌─────────────────────────────────────────┐
│  Rolling Summary (expanded)             │
│  Full 4-5 sentence version              │
│  Key moments highlighted                │
├─────────────────────────────────────────┤
│  Timeline                               │
│  Thumbnail strip of captured moments    │
│  Tap to reference in chat               │
├─────────────────────────────────────────┤
│  Chat Interface                         │
│  Conversation history                   │
│  Context-aware Q&A about session        │
│  ┌─────────────────────────────────┐    │
│  │ Ask anything...                 │    │
│  └─────────────────────────────────┘    │
├─────────────────────────────────────────┤
│  Status Bar                             │
│  12 screenshots │ Audio ● │ ◐ Ambient   │
└─────────────────────────────────────────┘
```

**Interaction:**
- Click outside or press Escape to collapse
- Summary continues evolving when collapsed
- Chat history preserved during session

---

## Intelligence Backend (Baleybots)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Sessions UI                                                 │
│  └─ useChat hook for conversation                           │
│  └─ Streaming events for real-time updates                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Baleybots Layer (Tauri backend / Proxy Server)             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Session Coordinator Bot                             │   │
│  │  - Orchestrates all analysis                        │   │
│  │  - Streams insights to UI                           │   │
│  │  - Manages child bot lifecycle                      │   │
│  └─────────────────────────────────────────────────────┘   │
│           │           │           │           │             │
│           ▼           ▼           ▼           ▼             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────┐ │
│  │ Analysis    │ │ Activity    │ │ Summarizer  │ │ Q&A   │ │
│  │ Controller  │ │ Detector    │ │ Bot         │ │ Bot   │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────┘ │
│                                                             │
│  Analysis Controller:                                       │
│  - Monitors session "pulse" (activity, audio density)      │
│  - Decides when to escalate/de-escalate analysis           │
│  - Controls which bots are active                          │
│                                                             │
│  Activity Detector:                                         │
│  - Processes screenshots for context changes               │
│  - Identifies app switches, significant moments            │
│  - Triggers ephemeral insight cards                        │
│                                                             │
│  Summarizer Bot:                                            │
│  - Maintains rolling summary                               │
│  - Updates as new information arrives                      │
│  - Highlights key moments                                  │
│                                                             │
│  Q&A Bot:                                                   │
│  - Handles chat interface                                  │
│  - Has full session context                                │
│  - Can query historical data                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Storage Layer (SQLite / PostgreSQL)                        │
│                                                             │
│  - Screenshots (with timestamps, metadata)                  │
│  - Audio chunks (transcribed)                              │
│  - Video segments (when enabled)                           │
│  - Generated insights                                       │
│  - Chat history                                            │
│  - Session metadata                                        │
└─────────────────────────────────────────────────────────────┘
```

### Bot Spawning

The Session Coordinator can dynamically spawn specialized bots:
- Additional analyzers for complex sessions
- Domain-specific bots (code review, meeting notes, etc.)
- Bots inherit context and can query session data

---

## Smart Capture System

### Screenshot Capture (Event-Driven)

**Triggers:**
- Application switch detected
- Window focus change
- Significant mouse movement after idle
- Keyboard activity burst
- Clipboard change (copy/paste)

**Fallback:**
- Maximum 1 minute between captures
- Ensures coverage even during passive viewing

**Implementation:**
- Tauri event listeners for system events
- Lightweight change detection
- Immediate storage to DB

### Audio Capture

- Continuous recording when enabled
- Chunked processing (configurable duration)
- Real-time transcription
- Always analyzed (essential for context)

### Video Capture

- Continuous recording when enabled
- Two analysis modes:

**High Analysis Mode:**
- Real-time frame analysis
- Activity detection
- Immediate insight generation

**Low Analysis Mode:**
- Recording only (stored to DB)
- Analysis on-demand when user asks
- Resource-conservative

---

## Analysis Modes

### User Control: Ambient Toggle

- Visible in recording UI (subtle indicator)
- Manual switch between Ambient (◐) and Deep (●) modes
- Persists user preference

### Adaptive Escalation

The Analysis Controller bot monitors:
- App switching frequency
- Audio density (talking vs silence)
- Screenshot change magnitude
- Keyboard/mouse activity patterns

**Auto-escalation triggers:**
- High activity detected → escalate to Deep
- Sustained silence/idle → de-escalate to Ambient
- Complex multi-app workflow → escalate
- Single-app focus → de-escalate

**User override:**
- Manual toggle always takes precedence
- System won't fight user's choice

---

## Data Flow

```
User Activity
     │
     ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Screenshot  │    │ Audio       │    │ Video       │
│ Capture     │    │ Capture     │    │ Capture     │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └────────────┬─────┴─────┬────────────┘
                    │           │
                    ▼           ▼
              ┌──────────┐ ┌──────────┐
              │ Storage  │ │ Baleybots│
              │ (DB)     │ │ Analysis │
              └──────────┘ └────┬─────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Rolling  │ │ Insight  │ │ Activity │
              │ Summary  │ │ Cards    │ │ Timeline │
              └──────────┘ └──────────┘ └──────────┘
                    │           │           │
                    └───────────┴───────────┘
                                │
                                ▼
                    ┌──────────────────────┐
                    │  Sessions UI         │
                    │  (Streaming Updates) │
                    └──────────────────────┘
```

---

## Recording Settings Updates

The pre-session settings modal needs updates:

**New Options:**
- Analysis Mode: Ambient / Deep / Adaptive (default)
- Smart Capture: On/Off (event-driven screenshots)
- Video Analysis: High / Low (when video enabled)

**Enhanced Feedback:**
- Show selected device names clearly
- Audio level indicator during setup
- "Test capture" button to verify permissions

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Pause/Resume recording |
| `⌘ Enter` | End session |
| `⌘ I` | Toggle Intelligence Panel |
| `⌘ /` | Focus chat input |
| `Escape` | Collapse Intelligence Panel |
| `⌘ P` | Pin current insight card |

---

## Future Considerations

1. **Proactive Insights** - AI suggests actions without being asked
2. **MCP Integration** - "Create Linear ticket from this insight"
3. **Multi-session Context** - Reference past sessions in chat
4. **Team Features** - Share session summaries
5. **Custom Bots** - User-defined specialist bots

---

## Technical Requirements

- Baleybots SDK integration (`@baleybots/core`, `@baleybots/react`)
- Database schema for session data
- Event system for Tauri ↔ React communication
- Streaming UI components for real-time updates
- Audio visualization (Web Audio API or similar)

---

## Open Questions

1. Database choice: SQLite (local-first) vs PostgreSQL (with pg_baleybots)?
2. Proxy server deployment: Embedded in Tauri vs separate service?
3. Transcription provider: Local (Whisper) vs API (Deepgram/AssemblyAI)?

---

## Next Steps

1. Review and validate this design
2. Create implementation plan with bite-sized tasks
3. Set up Baleybots integration
4. Build UI components incrementally
5. Wire up intelligence pipeline
