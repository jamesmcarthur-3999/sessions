# VC Demo Readiness Audit - February 3, 2026

## Executive Summary

Comprehensive audit across 6 domains found **23 issues** requiring attention:
- **Critical (must fix)**: 8 issues
- **Important (should fix)**: 10 issues
- **Minor (nice to have)**: 5 issues

## Critical Issues - MUST FIX BEFORE DEMO

### 1. macOS Privacy Descriptions Missing (100% confidence)
**Domain:** Rust Backend
**Impact:** App will crash when accessing microphone
**File:** `src-tauri/tauri.conf.json`

### 2. Foreign Keys Not Enforced (90% confidence)
**Domain:** Data Layer
**Impact:** Cascade deletes won't work, orphaned data
**File:** `src/services/database.ts`

### 3. Smart Capture Continues After Session Ends (95% confidence)
**Domain:** Session Recording
**Impact:** Extra screenshots captured after "stop"
**File:** `src/services/smart-capture.ts`

### 4. Keyboard Shortcuts Fire in Text Inputs (95% confidence)
**Domain:** Infrastructure
**Impact:** Shortcuts trigger while user is typing
**File:** `src/hooks/useKeyboardShortcuts.ts`

### 5. Missing Transaction Support (95% confidence)
**Domain:** Data Layer
**Impact:** Partial session creation on crash
**File:** `src/services/database.ts`

### 6. Bot Response Validation Inconsistent (90% confidence)
**Domain:** AI/Bots
**Impact:** Potential undefined access on malformed AI response
**Files:** Multiple bot call sites

### 7. Cleanup Race Condition (95% confidence)
**Domain:** Session Recording
**Impact:** Cleanup may run before end-session processing completes
**File:** `src/components/SessionRecording.tsx`

### 8. Rate Limit Handling Missing (90% confidence)
**Domain:** AI/Bots
**Impact:** Demo could hit API rate limits with no retry
**Files:** All bot.process() calls

## Important Issues - SHOULD FIX

1. Audio level listener memory leak (90%)
2. API key removal doesn't reset bot state (88%)
3. Settings test connection doesn't validate API (85%)
4. SQLite/localStorage sync race (85%)
5. localStorage quota not handled (85%)
6. Audio device name as ID race condition (85%)
7. Missing useEffect dependencies (85%)
8. Start Recording allows empty config (85%)
9. TranscriptViewer empty state check (95%)
10. Unused variables causing warnings (100%)

## Minor Issues - NICE TO HAVE

1. Missing accessibility labels (90%)
2. No size validation for base64 data (80%)
3. Periodic analysis checks deleted session (90%)
4. Unsafe FFI declarations (90%)
5. Build externals config verification (75%)

## Testing Checklist for Demo

- [ ] Fresh install on macOS - verify permission dialogs appear
- [ ] Start recording → immediately stop (< 5 seconds)
- [ ] Start → pause 10s → resume → stop → verify audio works
- [ ] Start → let run 2 minutes → stop → verify summary generates
- [ ] Start → navigate away before summary finishes
- [ ] Start with no API key → stop → verify graceful fallback
- [ ] Test with invalid API key - verify error message
- [ ] Disconnect external monitor during recording
- [ ] Multiple microphones - unplug non-default before starting
- [ ] Rapid app switching during recording
- [ ] Long session (30+ minutes) - verify no memory issues

## Recommended Fix Order

1. macOS privacy descriptions (5 min)
2. Foreign keys PRAGMA (2 min)
3. Smart capture stop flag (5 min)
4. Keyboard shortcuts input check (5 min)
5. Unused variables cleanup (5 min)
6. Bot response validation (15 min)
7. Transaction support (10 min)
8. Cleanup race condition flag (10 min)
