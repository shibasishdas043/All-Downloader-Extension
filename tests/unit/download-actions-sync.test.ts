// ============================================================
//  Unit Tests — Download Actions & UI Button State Synchronization
// ============================================================
import { describe, test, expect } from 'vitest';
import { DOWNLOAD_STATE } from '../../src/shared/constants.ts';

// Helper mirroring buildRowActions logic for deterministic headless testing
function determineRowActions(state: string) {
  const isActive = [
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING
  ].includes(state as any);
  const isPaused = state === DOWNLOAD_STATE.PAUSED || state === DOWNLOAD_STATE.QUEUED;
  const isError  = state === DOWNLOAD_STATE.ERROR || state === DOWNLOAD_STATE.CANCELLED;
  const isDone   = state === DOWNLOAD_STATE.COMPLETED;
  const canCancel = isActive || isPaused;

  return {
    showPause: isActive,
    showResume: isPaused,
    showRetry: isError || isDone,
    showCancel: canCancel,
    showFolder: isDone,
    showDelete: true,
    resumeTitle: state === DOWNLOAD_STATE.QUEUED ? 'Start' : 'Resume',
  };
}

// Helper mirroring popup renderer button logic
function determinePopupActions(state: string) {
  const needsCancel = [
    DOWNLOAD_STATE.QUEUED, DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING, DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING, DOWNLOAD_STATE.VERIFYING,
  ].includes(state as any);

  const isCompleted = state === DOWNLOAD_STATE.COMPLETED;
  const isFailed    = state === DOWNLOAD_STATE.CANCELLED || state === DOWNLOAD_STATE.ERROR;
  const isActive    = state === DOWNLOAD_STATE.DOWNLOADING || state === DOWNLOAD_STATE.CONNECTING;
  const isPaused    = state === DOWNLOAD_STATE.PAUSED || state === DOWNLOAD_STATE.QUEUED;

  return {
    showPause: isActive,
    showResume: isPaused,
    showCancel: needsCancel,
    showFolder: isCompleted,
    showRetry: isFailed,
    showRemove: isCompleted || isFailed,
  };
}

describe('Download Actions & Button Synchronization', () => {
  test('Active downloading shows Pause button, NOT Start/Resume button in Dashboard', () => {
    const actions = determineRowActions(DOWNLOAD_STATE.DOWNLOADING);
    expect(actions.showPause).toBe(true);
    expect(actions.showResume).toBe(false);
    expect(actions.showCancel).toBe(true);
    expect(actions.showRetry).toBe(false);
  });

  test('Connecting state shows Pause button, NOT Start/Resume button in Dashboard', () => {
    const actions = determineRowActions(DOWNLOAD_STATE.CONNECTING);
    expect(actions.showPause).toBe(true);
    expect(actions.showResume).toBe(false);
    expect(actions.showCancel).toBe(true);
  });

  test('Cancelled download shows Re-download and Delete, but neither Pause nor Start', () => {
    const actions = determineRowActions(DOWNLOAD_STATE.CANCELLED);
    expect(actions.showPause).toBe(false);
    expect(actions.showResume).toBe(false);
    expect(actions.showRetry).toBe(true);
    expect(actions.showDelete).toBe(true);
    expect(actions.showCancel).toBe(false);
  });

  test('Re-download transition: cancelling then re-downloading immediately renders Pause, never Start', () => {
    // 1. Initial active download
    let curState = DOWNLOAD_STATE.DOWNLOADING;
    expect(determineRowActions(curState).showPause).toBe(true);

    // 2. User cancels
    curState = DOWNLOAD_STATE.CANCELLED;
    const cancelledActions = determineRowActions(curState);
    expect(cancelledActions.showRetry).toBe(true);
    expect(cancelledActions.showPause).toBe(false);
    expect(cancelledActions.showResume).toBe(false);

    // 3. User clicks Re-download: optimistic state transitions to CONNECTING
    curState = DOWNLOAD_STATE.CONNECTING;
    const retriedActions = determineRowActions(curState);
    expect(retriedActions.showPause).toBe(true);
    expect(retriedActions.showResume).toBe(false);
    expect(retriedActions.showCancel).toBe(true);

    // 4. Background sends progress update: state is DOWNLOADING
    curState = DOWNLOAD_STATE.DOWNLOADING;
    const runningActions = determineRowActions(curState);
    expect(runningActions.showPause).toBe(true);
    expect(runningActions.showResume).toBe(false);
  });

  test('Popup UI action buttons match Dashboard semantics during cancel & re-download cycle', () => {
    // 1. Downloading
    expect(determinePopupActions(DOWNLOAD_STATE.DOWNLOADING).showPause).toBe(true);
    expect(determinePopupActions(DOWNLOAD_STATE.DOWNLOADING).showResume).toBe(false);

    // 2. Cancelled
    expect(determinePopupActions(DOWNLOAD_STATE.CANCELLED).showRetry).toBe(true);
    expect(determinePopupActions(DOWNLOAD_STATE.CANCELLED).showPause).toBe(false);

    // 3. Retry clicked -> CONNECTING
    expect(determinePopupActions(DOWNLOAD_STATE.CONNECTING).showPause).toBe(true);
    expect(determinePopupActions(DOWNLOAD_STATE.CONNECTING).showResume).toBe(false);
  });

  test('Paused download shows Resume button, not Pause button', () => {
    const actions = determineRowActions(DOWNLOAD_STATE.PAUSED);
    expect(actions.showPause).toBe(false);
    expect(actions.showResume).toBe(true);
    expect(actions.resumeTitle).toBe('Resume');
  });

  test('Queued download shows Start button', () => {
    const actions = determineRowActions(DOWNLOAD_STATE.QUEUED);
    expect(actions.showPause).toBe(false);
    expect(actions.showResume).toBe(true);
    expect(actions.resumeTitle).toBe('Start');
  });
});
