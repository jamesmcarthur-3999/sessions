/* eslint-disable no-console */
/**
 * Production-safe logger utility
 *
 * Gates debug/info logging behind import.meta.env.DEV.
 * console.warn and console.error always pass through.
 */

const isDev = import.meta.env.DEV

/** Debug-level log, stripped in production */
function debug(...args: unknown[]): void {
  if (isDev) console.log(...args)
}

/** Info-level log, stripped in production */
function info(...args: unknown[]): void {
  if (isDev) console.log(...args)
}

/** Warning — always logged */
function warn(...args: unknown[]): void {
  console.warn(...args)
}

/** Error — always logged */
function error(...args: unknown[]): void {
  console.error(...args)
}

export const logger = { debug, info, warn, error }
