// Browser shim for @baleybots/core (Node.js-only package)
// This shim provides stub implementations that won't break imports
// The actual bots functionality only runs in Tauri context

import type { ZodType } from 'zod'

interface BaleybotConfig {
  name: string
  goal: string
  model?: string
  outputSchema?: ZodType<unknown>
}

interface TextContent {
  type: 'text'
  text: string
}

interface ImageContent {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

type ContentBlock = TextContent | ImageContent

class BaleybotImpl {
  private config: BaleybotConfig

  constructor(config: BaleybotConfig) {
    this.config = config
    console.warn(`@baleybots/core: Baleybot "${config.name}" created in browser context (stub)`)
  }

  async run(_input: unknown): Promise<unknown> {
    console.warn(`@baleybots/core: Baleybot "${this.config.name}".run() called in browser context`)
    throw new Error('@baleybots/core: Baleybot.run() not available in browser context')
  }

  async *stream(_input: unknown): AsyncGenerator<unknown, unknown, unknown> {
    console.warn(`@baleybots/core: Baleybot "${this.config.name}".stream() called in browser context`)
    throw new Error('@baleybots/core: Baleybot.stream() not available in browser context')
  }
}

export const Baleybot = {
  create(config: BaleybotConfig): BaleybotImpl {
    return new BaleybotImpl(config)
  }
}

export function text(content: string): TextContent {
  return {
    type: 'text',
    text: content
  }
}

export function image(options: { data: string; mediaType: string }): ImageContent {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: options.mediaType,
      data: options.data
    }
  }
}

export function combine(...contents: ContentBlock[]): ContentBlock[] {
  return contents
}

// Re-export common types that might be imported
export type { BaleybotConfig, ContentBlock, TextContent, ImageContent }
