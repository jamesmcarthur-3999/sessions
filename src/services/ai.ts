/**
 * AI Service
 *
 * @deprecated This service is deprecated. Use Baleybots pipelines instead:
 * - For captures: use createCapturePipeline() from './bots'
 * - For sessions: use createFinalSummaryPipeline() from './bots'
 * - For chat: use createQABotPipeline() from './bots'
 *
 * This file is kept for reference but should not be used for new code.
 *
 * Handles AI-powered summarization and task extraction.
 * Uses Claude API when configured, falls back to smart mock responses.
 */

import type { Summary, Task, Note } from '../types'
import { generateId } from '../utils/id'

interface ProcessCaptureResult {
  title: string
  summary: Summary
}

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

class AIService {
  private apiKey: string | null = null
  private baseUrl = 'https://api.anthropic.com/v1'

  setApiKey(key: string) {
    this.apiKey = key?.trim() || null
  }

  hasApiKey(): boolean {
    return !!this.apiKey && this.apiKey.startsWith('sk-ant-')
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<boolean> {
    if (!this.hasApiKey()) return false

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey!,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      })

      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Make a request to Claude API
   */
  private async callClaude(
    systemPrompt: string,
    messages: ClaudeMessage[],
    maxTokens = 1024
  ): Promise<string> {
    if (!this.hasApiKey()) {
      throw new Error('No API key configured')
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Claude API error: ${error}`)
    }

    const data = await response.json()
    return data.content[0]?.text || ''
  }

  /**
   * Process a text capture and generate a summary
   */
  async processCapture(text: string, _attachments?: File[]): Promise<ProcessCaptureResult> {
    // If we have an API key, use Claude
    if (this.hasApiKey()) {
      try {
        return await this.processWithClaude(text)
      } catch (error) {
        console.error('Claude API error, falling back to mock:', error)
        // Fall through to mock
      }
    }

    // Simulate processing delay for mock
    await new Promise(resolve => setTimeout(resolve, 1500))
    return this.generateMockSummary(text)
  }

  /**
   * Process capture with Claude API
   */
  private async processWithClaude(text: string): Promise<ProcessCaptureResult> {
    const systemPrompt = `You are an AI assistant that analyzes captured text and extracts structured information.

Your job is to:
1. Create a concise, descriptive title (2-6 words)
2. Write a brief summary paragraph capturing the essence
3. Extract actionable tasks (things to do, follow up on)
4. Extract key notes or insights worth remembering

Respond in JSON format exactly like this:
{
  "title": "Meeting with Design Team",
  "summary": "Brief paragraph summarizing the content...",
  "tasks": ["Task 1", "Task 2"],
  "notes": ["Key insight 1", "Important note 2"]
}

Be concise but insightful. If there are no clear tasks, return an empty array. Same for notes.`

    const response = await this.callClaude(systemPrompt, [
      { role: 'user', content: `Please analyze this captured text:\n\n${text}` }
    ])

    // Parse JSON response
    try {
      // Extract JSON from response (handle potential markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')

      const parsed = JSON.parse(jsonMatch[0])

      return {
        title: parsed.title || 'Captured Note',
        summary: {
          text: parsed.summary || 'Content captured and analyzed.',
          tasks: (parsed.tasks || []).map((t: string) => ({
            id: generateId(),
            title: t,
            completed: false,
          })),
          notes: (parsed.notes || []).map((n: string) => ({
            id: generateId(),
            content: n,
          })),
          generatedAt: new Date().toISOString(),
        },
      }
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError)
      // Return a basic response using the raw text
      return {
        title: 'Captured Note',
        summary: {
          text: response.slice(0, 500),
          tasks: [],
          notes: [],
          generatedAt: new Date().toISOString(),
        },
      }
    }
  }

  /**
   * Process a recorded session with screenshots
   */
  async processSession(
    screenshots: string[],
    audioTranscript?: string
  ): Promise<Summary> {
    // If we have API key and screenshots, use Claude vision
    if (this.hasApiKey() && screenshots.length > 0) {
      try {
        return await this.processSessionWithClaude(screenshots, audioTranscript)
      } catch (error) {
        console.error('Claude session processing error, falling back to mock:', error)
      }
    }

    // Simulate processing delay for mock
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Generate mock response based on session data
    const screenshotInfo = screenshots.length > 0
      ? `Analyzed ${screenshots.length} screenshots from your work session.`
      : 'No screenshots were captured during this session.'

    return {
      text: `${screenshotInfo} The AI analyzed your session and identified key activities and potential follow-ups. Configure your Claude API key to enable intelligent session analysis.`,
      tasks: [
        { id: generateId(), title: 'Review the work completed in this session', completed: false },
        { id: generateId(), title: 'Follow up on any pending items', completed: false },
      ],
      notes: [
        { id: generateId(), content: `Session included ${screenshots.length} screenshots` },
      ],
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Process session with Claude vision API
   */
  private async processSessionWithClaude(
    screenshots: string[],
    audioTranscript?: string
  ): Promise<Summary> {
    // For vision, we need to use a different message format
    // Take a sample of screenshots (first, middle, last) to avoid token limits
    const sampleIndices = this.getSampleIndices(screenshots.length, 5)
    const sampleScreenshots = sampleIndices.map(i => screenshots[i])

    const systemPrompt = `You are analyzing a work session that was recorded with screenshots.

Your job is to:
1. Understand what the user was working on by analyzing the screenshots
2. Write a concise summary of the session activities
3. Extract any tasks or action items you can identify
4. Note any important observations or insights

Respond in JSON format exactly like this:
{
  "summary": "Brief summary of what was accomplished during the session...",
  "tasks": ["Task 1 identified from the session", "Task 2"],
  "notes": ["Important observation 1", "Key insight 2"]
}

Be specific about what you see in the screenshots. If you can identify specific applications, documents, or activities, mention them.`

    // Build content with images
    const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [
      {
        type: 'text',
        text: `Please analyze this work session. ${audioTranscript ? `Audio transcript: ${audioTranscript}` : 'No audio transcript available.'}\n\nHere are ${sampleScreenshots.length} screenshots from the session:`,
      },
    ]

    // Add screenshots as images
    for (const screenshot of sampleScreenshots) {
      // Extract base64 data (remove data:image/png;base64, prefix)
      const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '')
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: base64Data,
        },
      })
    }

    // Make API call with vision
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Claude API error: ${error}`)
    }

    const data = await response.json()
    const responseText = data.content[0]?.text || ''

    // Parse JSON response
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')

      const parsed = JSON.parse(jsonMatch[0])

      return {
        text: parsed.summary || 'Session analyzed.',
        tasks: (parsed.tasks || []).map((t: string) => ({
          id: generateId(),
          title: t,
          completed: false,
        })),
        notes: (parsed.notes || []).map((n: string) => ({
          id: generateId(),
          content: n,
        })),
        generatedAt: new Date().toISOString(),
      }
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError)
      return {
        text: responseText.slice(0, 500),
        tasks: [],
        notes: [],
        generatedAt: new Date().toISOString(),
      }
    }
  }

  /**
   * Get evenly distributed sample indices
   */
  private getSampleIndices(total: number, maxSamples: number): number[] {
    if (total <= maxSamples) {
      return Array.from({ length: total }, (_, i) => i)
    }

    const indices: number[] = [0] // Always include first
    const step = (total - 1) / (maxSamples - 1)

    for (let i = 1; i < maxSamples - 1; i++) {
      indices.push(Math.round(i * step))
    }

    indices.push(total - 1) // Always include last
    return indices
  }

  /**
   * Generate a mock summary based on input text
   */
  private generateMockSummary(text: string): ProcessCaptureResult {
    const words = text.split(/\s+/).length
    const hasTaskKeywords = /todo|task|need to|should|must|remember to|don't forget/i.test(text)
    const hasMeetingKeywords = /meeting|call|discussed|talked|agreed|decision/i.test(text)
    const hasCodeKeywords = /bug|fix|implement|refactor|api|function|code|error/i.test(text)

    // Generate a contextual title
    let title = 'Quick Capture'
    if (hasMeetingKeywords) title = 'Meeting Notes'
    else if (hasCodeKeywords) title = 'Development Notes'
    else if (hasTaskKeywords) title = 'Tasks & Reminders'
    else if (words > 50) title = 'Detailed Notes'

    // Generate summary text
    let summaryText = ''
    if (words < 20) {
      summaryText = `Quick note captured: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`
    } else if (hasMeetingKeywords) {
      summaryText = `Meeting notes captured with ${words} words. Key discussion points have been identified and action items extracted.`
    } else if (hasCodeKeywords) {
      summaryText = `Technical notes captured regarding development work. Tasks have been extracted for follow-up.`
    } else {
      summaryText = `Captured ${words} words of notes. Content has been analyzed and organized.`
    }

    // Extract mock tasks from text
    const tasks: Task[] = []
    const taskPatterns = [
      /(?:todo|task|need to|should|must|remember to|don't forget)[:\s]+([^.!?\n]+)/gi,
      /\[ \]\s*([^\n]+)/g, // Markdown checkboxes
      /^[-*]\s+([^\n]+)/gm, // Bullet points that might be tasks
    ]

    for (const pattern of taskPatterns) {
      let match
      while ((match = pattern.exec(text)) !== null && tasks.length < 5) {
        const taskText = match[1].trim()
        if (taskText.length > 5 && taskText.length < 200) {
          tasks.push({
            id: generateId(),
            title: taskText,
            completed: false,
          })
        }
      }
    }

    // If no tasks found but has task keywords, create a generic one
    if (tasks.length === 0 && hasTaskKeywords) {
      tasks.push({
        id: generateId(),
        title: 'Review and action items from this capture',
        completed: false,
      })
    }

    // Extract notes (sentences that seem like key points)
    const notes: Note[] = []
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20)

    for (const sentence of sentences.slice(0, 3)) {
      const trimmed = sentence.trim()
      if (trimmed.length > 20 && trimmed.length < 300) {
        notes.push({
          id: generateId(),
          content: trimmed,
        })
      }
    }

    return {
      title,
      summary: {
        text: summaryText,
        tasks,
        notes,
        generatedAt: new Date().toISOString(),
      },
    }
  }

  // Store chat history per session
  private chatHistories: Map<string, ClaudeMessage[]> = new Map()

  /**
   * Chat with AI about a session (for MCP actions)
   */
  async chat(sessionId: string, message: string, sessionContext?: string): Promise<string> {
    // If we have API key, use Claude - and let errors propagate so user sees them
    if (this.hasApiKey()) {
      return await this.chatWithClaude(sessionId, message, sessionContext)
    }

    // Mock response fallback
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 700))
    const lowerMessage = message.toLowerCase()

    // Contextual responses for common actions
    if (lowerMessage.includes('linear') || lowerMessage.includes('ticket')) {
      return "I'd love to create a Linear ticket for you! Once the MCP integration is configured, I'll be able to:\n\n• Create issues with title, description, and labels\n• Set priority and assign team members\n• Link related issues\n\nSet up the Linear MCP to enable this."
    }

    if (lowerMessage.includes('notion') || lowerMessage.includes('page')) {
      return "Great idea to save this to Notion! With the Notion MCP, I can:\n\n• Create new pages in any database\n• Format content with rich text\n• Add tags and properties\n\nConnect your Notion workspace to get started."
    }

    if (lowerMessage.includes('slack') || lowerMessage.includes('share') || lowerMessage.includes('team')) {
      return "Sharing with your team is a great idea! The Slack MCP will let me:\n\n• Post summaries to any channel\n• Format with rich blocks\n• @mention relevant people\n\nConfigure Slack integration to enable sharing."
    }

    if (lowerMessage.includes('email') || lowerMessage.includes('send')) {
      return "I can help draft that! Email integration will allow me to:\n\n• Compose and send emails\n• Include formatted summaries\n• CC relevant stakeholders\n\nThis feature is coming with MCP mail integrations."
    }

    if (lowerMessage.includes('calendar') || lowerMessage.includes('schedule') || lowerMessage.includes('meeting')) {
      return "I'd be happy to help schedule something! With calendar integration I can:\n\n• Create events with all the details\n• Send invites to attendees\n• Add meeting notes as attachments\n\nCalendar MCP coming soon."
    }

    if (lowerMessage.includes('todoist') || lowerMessage.includes('task')) {
      return "Adding tasks is a great way to follow up! Todoist integration will enable:\n\n• Creating tasks with due dates\n• Setting priorities and labels\n• Organizing into projects\n\nConnect Todoist to start managing tasks."
    }

    if (lowerMessage.includes('summarize') || lowerMessage.includes('shorter')) {
      return "Here's a more concise version of the key points:\n\n1. Main topic captured and analyzed\n2. Action items extracted\n3. Key notes highlighted\n\nWould you like me to focus on any specific aspect?"
    }

    if (lowerMessage.includes('help') || lowerMessage.includes('what can you')) {
      return "I can help you take action on your captures! Try asking me to:\n\n• Create a Linear ticket\n• Add to Notion\n• Share on Slack\n• Schedule a follow-up\n• Summarize differently\n\nMCP integrations make these actions possible."
    }

    // Default contextual response
    return "I understand you want to take action on this capture. Here's what I can help with once MCPs are configured:\n\n• **Linear** – Create tickets from tasks\n• **Notion** – Save notes to your workspace\n• **Slack** – Share with your team\n• **Calendar** – Schedule follow-ups\n\nWhat would you like to set up first?"
  }

  /**
   * Chat with Claude about a session
   */
  private async chatWithClaude(
    sessionId: string,
    message: string,
    sessionContext?: string
  ): Promise<string> {
    // Get or create chat history for this session
    let history = this.chatHistories.get(sessionId) || []

    const systemPrompt = `You are a helpful AI assistant integrated into Sessions, an app for capturing work sessions and notes.

${sessionContext ? `Here's the context of the current session the user is asking about:\n${sessionContext}\n\n` : ''}

You help users:
- Understand and reflect on their captured content
- Take action by describing how MCP integrations would work
- Answer questions about their sessions
- Suggest follow-up actions

Be friendly, concise, and helpful. Use markdown formatting when appropriate.
If the user asks about integrations (Linear, Notion, Slack, etc.), explain what would happen with MCP integration.`

    // Add user message to history
    history.push({ role: 'user', content: message })

    try {
      const response = await this.callClaude(systemPrompt, history, 512)

      // Add assistant response to history
      history.push({ role: 'assistant', content: response })

      // Keep history limited to last 10 exchanges
      if (history.length > 20) {
        history = history.slice(-20)
      }

      this.chatHistories.set(sessionId, history)

      // LRU eviction: remove oldest entries if over limit
      const MAX_CHAT_HISTORIES = 20
      if (this.chatHistories.size > MAX_CHAT_HISTORIES) {
        const firstKey = this.chatHistories.keys().next().value
        if (firstKey) this.chatHistories.delete(firstKey)
      }

      return response
    } catch (error) {
      // Remove the user message we just added
      history.pop()
      throw error
    }
  }

  /**
   * Clear chat history for a session
   */
  clearChatHistory(sessionId: string) {
    this.chatHistories.delete(sessionId)
  }
}

export const ai = new AIService()
