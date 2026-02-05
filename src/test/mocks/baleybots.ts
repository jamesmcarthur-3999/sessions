/**
 * Baleybots Mock
 *
 * Mock implementations of Baleybots pipelines and utilities for testing.
 */

import { vi } from 'vitest';
import type { ActivityDetection, RollingSummary, CaptureTimingDecision } from '../../services/bots/types';

// Default mock responses
export const mockActivityDetection: ActivityDetection = {
  currentApp: 'VS Code',
  currentContext: 'Editing TypeScript file',
  activityType: 'coding',
  hasSignificantChange: false,
  suggestedInsight: null,
};

export const mockRollingSummary: RollingSummary = {
  summary: 'Working on TypeScript project',
  keyMoments: ['Started editing', 'Saved file'],
  currentFocus: 'Code editing',
};

export const mockCaptureTiming: CaptureTimingDecision = {
  recommendedWaitSeconds: 60,
  activityLevel: 'medium',
  reason: 'Normal coding activity',
};

// Mock pipeline factories
export const createMockPipeline = <T>(mockResult: T) => ({
  process: vi.fn().mockResolvedValue(mockResult),
  subscribe: vi.fn(),
  getSteps: vi.fn().mockReturnValue([]),
});

// Mock the bots module
export const mockBotsModule = {
  createActivityDetectorPipeline: vi.fn(() => createMockPipeline(mockActivityDetection)),
  createSummarizerPipeline: vi.fn(() => createMockPipeline(mockRollingSummary)),
  createCaptureTimingPipeline: vi.fn(() => createMockPipeline(mockCaptureTiming)),
  createAnalysisControllerPipeline: vi.fn(() =>
    createMockPipeline({ recommendedMode: 'ambient', confidence: 0.5, reason: 'Default' })
  ),
  createQABotPipeline: vi.fn(() => createMockPipeline({ answer: 'Mock answer' })),
  createFinalSummaryPipeline: vi.fn(() => createMockPipeline({ summary: 'Final summary' })),
  buildActivityDetectorInput: vi.fn((imageBase64: string, previousAnalysis?: string) => ({
    imageBase64,
    previousAnalysis,
  })),
  buildSummarizerInput: vi.fn((context: any) => ({ context })),
  buildCaptureTimingInput: vi.fn((analysis: string, metrics: any) => ({ analysis, metrics })),
  buildAnalysisControllerInput: vi.fn((context: any, metrics: any) => ({ context, metrics })),
  buildQAInput: vi.fn((question: string, context: any) => ({ question, context })),
};

// Mock the baleybots core module
export const mockBaleybotCore = {
  Baleybot: {
    setGlobalConfig: vi.fn(),
  },
  setDefaultApiKey: vi.fn(),
  withRetry: vi.fn(async <T>(operation: () => Promise<T>) => {
    const result = await operation();
    return { success: true, value: result, attempts: 1 };
  }),
  PipelineError: class MockPipelineError extends Error {
    stepTrace: any[];
    override cause: Error;
    constructor(message: string, stepTrace: any[] = [], cause?: Error) {
      super(message);
      this.name = 'PipelineError';
      this.stepTrace = stepTrace;
      this.cause = cause || new Error(message);
    }
  },
};

// Helper to reset all mocks
export function resetBaleybotsMocks(): void {
  Object.values(mockBotsModule).forEach((mock) => {
    if (typeof mock === 'function' && 'mockClear' in mock) {
      mock.mockClear();
    }
  });
  Object.values(mockBaleybotCore).forEach((mock) => {
    if (typeof mock === 'function' && 'mockClear' in mock) {
      mock.mockClear();
    }
  });
}

// Helper to configure mock responses
export function setMockActivityDetection(detection: Partial<ActivityDetection>): void {
  const result = { ...mockActivityDetection, ...detection };
  mockBotsModule.createActivityDetectorPipeline.mockReturnValue(createMockPipeline(result));
}

export function setMockRollingSummary(summary: Partial<RollingSummary>): void {
  const result = { ...mockRollingSummary, ...summary };
  mockBotsModule.createSummarizerPipeline.mockReturnValue(createMockPipeline(result));
}

export function setMockCaptureTiming(timing: Partial<CaptureTimingDecision>): void {
  const result = { ...mockCaptureTiming, ...timing };
  mockBotsModule.createCaptureTimingPipeline.mockReturnValue(createMockPipeline(result));
}
