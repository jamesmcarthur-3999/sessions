/**
 * useSessionChat Hook
 *
 * Manages chat interactions with the session Q&A bot via worker.
 */

import { useState, useEffect, useCallback } from 'react';
import { sessionBridge } from '../services/session-bridge';
import { getChatHistory } from '../services/database';
import { generateId } from '../utils/id';
import type { DbChatMessage } from '../types/database';

interface ChatState {
  messages: DbChatMessage[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
}

export function useSessionChat(sessionId: string | null) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: true,
    isSending: false,
    error: null,
  });

  // Load chat history
  useEffect(() => {
    if (!sessionId) {
      setState(s => ({ ...s, isLoading: false }));
      return;
    }

    async function loadHistory() {
      if (!sessionId) return;
      try {
        const messages = await getChatHistory(sessionId);
        setState({
          messages,
          isLoading: false,
          isSending: false,
          error: null,
        });
      } catch (error) {
        setState(s => ({
          ...s,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load chat history',
        }));
      }
    }

    loadHistory();
  }, [sessionId]);

  // Subscribe to chat responses
  useEffect(() => {
    if (!sessionId) return;

    const unsub = sessionBridge.on('chat-response', async (data) => {
      if (data.sessionId === sessionId) {
        // Reload messages to get the new response
        const messages = await getChatHistory(sessionId);
        setState(s => ({ ...s, messages, isSending: false }));
      }
    });

    return unsub;
  }, [sessionId]);

  // Send a message
  const sendMessage = useCallback(async (message: string) => {
    if (!sessionId || !message.trim()) return;

    const optimisticMessage: DbChatMessage = {
      id: generateId(),
      session_id: sessionId,
      created_at: new Date().toISOString(),
      role: 'user',
      content: message,
      metadata: null,
    };

    setState(s => ({
      ...s,
      isSending: true,
      error: null,
      messages: [...s.messages, optimisticMessage],
    }));

    try {
      // Send to session bridge (response will come via event)
      await sessionBridge.handleChatMessage(sessionId, message);
    } catch (error) {
      setState(s => ({
        ...s,
        isSending: false,
        error: error instanceof Error ? error.message : 'Failed to send message',
      }));
    }
  }, [sessionId]);

  const clearError = useCallback(() => {
    setState(s => ({ ...s, error: null }));
  }, []);

  return {
    ...state,
    sendMessage,
    clearError,
  };
}
