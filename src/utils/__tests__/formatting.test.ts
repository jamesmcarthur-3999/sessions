import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatDuration,
  formatDate,
  formatDateShort,
  formatRelativeTime,
  formatRelativeTimeLive,
  formatBytes,
} from '../formatting'

describe('formatDuration', () => {
  it('formats minutes only', () => {
    expect(formatDuration(300)).toBe('5m')
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(59)).toBe('0m')
    expect(formatDuration(60)).toBe('1m')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(3600)).toBe('1h 0m')
    expect(formatDuration(3660)).toBe('1h 1m')
    expect(formatDuration(7380)).toBe('2h 3m')
  })
})

describe('formatDate', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns Today for same day', () => {
    vi.setSystemTime(new Date('2025-06-15T14:00:00'))
    expect(formatDate('2025-06-15T10:00:00')).toBe('Today')
  })

  it('returns Yesterday for previous day', () => {
    vi.setSystemTime(new Date('2025-06-15T14:00:00'))
    expect(formatDate('2025-06-14T10:00:00')).toBe('Yesterday')
  })

  it('returns full date for older dates', () => {
    vi.setSystemTime(new Date('2025-06-15T14:00:00'))
    const result = formatDate('2025-06-10T10:00:00')
    expect(result).toContain('June')
    expect(result).toContain('10')
  })
})

describe('formatDateShort', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns Today for same day', () => {
    vi.setSystemTime(new Date('2025-06-15T14:00:00'))
    expect(formatDateShort('2025-06-15T10:00:00')).toBe('Today')
  })

  it('returns weekday for recent dates', () => {
    vi.setSystemTime(new Date('2025-06-15T14:00:00')) // Sunday
    const result = formatDateShort('2025-06-12T10:00:00') // Thursday
    expect(result).toContain('Thursday')
    expect(result).not.toContain('June') // No month for <7 days
  })

  it('returns weekday + short month for older dates', () => {
    vi.setSystemTime(new Date('2025-06-15T14:00:00'))
    const result = formatDateShort('2025-06-01T10:00:00')
    expect(result).toContain('Jun')
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns Just now for less than a minute', () => {
    const now = new Date('2025-06-15T14:00:00')
    vi.setSystemTime(now)
    expect(formatRelativeTime(new Date('2025-06-15T13:59:30'))).toBe('Just now')
  })

  it('returns minutes ago', () => {
    vi.setSystemTime(new Date('2025-06-15T14:05:00'))
    expect(formatRelativeTime(new Date('2025-06-15T14:00:00'))).toBe('5m ago')
  })

  it('returns hours ago', () => {
    vi.setSystemTime(new Date('2025-06-15T16:00:00'))
    expect(formatRelativeTime(new Date('2025-06-15T14:00:00'))).toBe('2h ago')
  })

  it('accepts string dates', () => {
    vi.setSystemTime(new Date('2025-06-15T16:00:00'))
    expect(formatRelativeTime('2025-06-15T14:00:00')).toBe('2h ago')
  })

  it('returns Yesterday', () => {
    vi.setSystemTime(new Date('2025-06-15T14:00:00'))
    expect(formatRelativeTime(new Date('2025-06-14T10:00:00'))).toBe('Yesterday')
  })

  it('returns days ago for <7 days', () => {
    vi.setSystemTime(new Date('2025-06-15T14:00:00'))
    expect(formatRelativeTime(new Date('2025-06-12T10:00:00'))).toBe('3d ago')
  })
})

describe('formatRelativeTimeLive', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns now for very recent', () => {
    const now = new Date('2025-06-15T14:00:00')
    vi.setSystemTime(now)
    expect(formatRelativeTimeLive(new Date('2025-06-15T13:59:55'))).toBe('now')
  })

  it('returns seconds', () => {
    vi.setSystemTime(new Date('2025-06-15T14:00:30'))
    expect(formatRelativeTimeLive(new Date('2025-06-15T14:00:00'))).toBe('30s')
  })

  it('returns minutes', () => {
    vi.setSystemTime(new Date('2025-06-15T14:05:00'))
    expect(formatRelativeTimeLive(new Date('2025-06-15T14:00:00'))).toBe('5m')
  })
})

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB')
  })
})
