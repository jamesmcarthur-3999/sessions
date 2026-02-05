/**
 * useSessionIntelligence Hook
 *
 * Connects React components to the session bridge (which forwards worker events).
 * Provides real-time updates for summary, insights, and mode.
 */

import { useState, useEffect, useCallback } from 'react';
import { sessionBridge } from '../services/session-bridge';
import { getRollingSummary, getInsights, getAnalysisState, pinInsight } from '../services/database';
import type { DbInsight } from '../types/database';

interface SessionIntelligenceState {
  summary: string;
  insights: DbInsight[];
  analysisMode: 'ambient' | 'deep';
  isLoading: boolean;
  error: string | null;
}

export function useSessionIntelligence(sessionId: string | null) {
  const [state, setState] = useState<SessionIntelligenceState>({
    summary: '',
    insights: [],
    analysisMode: 'ambient',
    isLoading: true,
    error: null,
  });

  // Load initial data
  useEffect(() => {
    if (!sessionId) {
      setState(s => ({ ...s, isLoading: false }));
      return;
    }

    async function loadInitialData() {
      if (!sessionId) return;
      try {
        const [summary, insights, analysisState] = await Promise.all([
          getRollingSummary(sessionId),
          getInsights(sessionId),
          getAnalysisState(sessionId),
        ]);

        setState({
          summary: summary?.content || '',
          insights,
          analysisMode: analysisState?.mode === 'deep' ? 'deep' : 'ambient',
          isLoading: false,
          error: null,
        });
      } catch (error) {
        setState(s => ({
          ...s,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load session data',
        }));
      }
    }

    loadInitialData();
  }, [sessionId]);

  // Subscribe to session bridge events (forwarded from worker)
  useEffect(() => {
    if (!sessionId) return;

    const unsubSummary = sessionBridge.on('summary-updated', (data) => {
      if (data.sessionId === sessionId) {
        setState(s => ({ ...s, summary: data.summary }));
      }
    });

    const unsubInsight = sessionBridge.on('insight-created', async (data) => {
      if (data.sessionId === sessionId) {
        // Reload insights to get the new one
        const insights = await getInsights(sessionId);
        setState(s => ({ ...s, insights }));
      }
    });

    const unsubMode = sessionBridge.on('mode-changed', (data) => {
      if (data.sessionId === sessionId) {
        setState(s => ({ ...s, analysisMode: data.mode }));
      }
    });

    const unsubError = sessionBridge.on('error', (data) => {
      if (data.sessionId === sessionId) {
        setState(s => ({ ...s, error: data.error }));
      }
    });

    return () => {
      unsubSummary();
      unsubInsight();
      unsubMode();
      unsubError();
    };
  }, [sessionId]);

  // Actions
  const setAnalysisMode = useCallback(async (mode: 'ambient' | 'deep') => {
    if (!sessionId) return;
    await sessionBridge.setAnalysisMode(sessionId, mode);
  }, [sessionId]);

  const handlePinInsight = useCallback(async (insightId: string, pinned: boolean) => {
    if (!sessionId) return;
    await pinInsight(insightId, pinned);
    const insights = await getInsights(sessionId);
    setState(s => ({ ...s, insights }));
  }, [sessionId]);

  return {
    ...state,
    setAnalysisMode,
    pinInsight: handlePinInsight,
  };
}
