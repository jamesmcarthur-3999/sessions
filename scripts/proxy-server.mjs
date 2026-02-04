#!/usr/bin/env node
/**
 * Baleybots Proxy Server
 *
 * Runs alongside the frontend to proxy AI API calls.
 * Keeps API keys secure on the server side.
 */

import { createBaleybotProxy } from '@baleybots/proxy-server';

const proxy = createBaleybotProxy({
  port: 3001,
  logging: 'verbose',
  cors: {
    origins: ['http://localhost:5173', 'http://localhost:1420', 'tauri://localhost'],
  },
});

proxy.listen();
console.log('🤖 Baleybots proxy server running on http://localhost:3001');
