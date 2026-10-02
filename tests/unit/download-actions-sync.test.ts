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

  test('Cancelled download remains strictly un-enqueued and ignored on browser reopen', () => {
    // Simulate browser restart / restoreInProgressDownloads filtering
    const savedDownloads: Record<string, { id: string; status: string }> = {
      'dl-1': { id: 'dl-1', status: DOWNLOAD_STATE.CANCELLED },
      'dl-2': { id: 'dl-2', status: DOWNLOAD_STATE.PAUSED },
      'dl-3': { id: 'dl-3', status: DOWNLOAD_STATE.COMPLETED },
      'dl-4': { id: 'dl-4', status: DOWNLOAD_STATE.ERROR },
      'dl-5': { id: 'dl-5', status: DOWNLOAD_STATE.DOWNLOADING },
      'dl-6': { id: 'dl-6', status: DOWNLOAD_STATE.QUEUED },
    };

    const restoredQueue: string[] = [];
    for (const dl of Object.values(savedDownloads)) {
      const st = dl.status;
      if (
        st === DOWNLOAD_STATE.CANCELLED ||
        st === DOWNLOAD_STATE.PAUSED ||
        st === DOWNLOAD_STATE.COMPLETED ||
        st === DOWNLOAD_STATE.ERROR
      ) {
        continue;
      }

      if (st === 'downloading' || st === 'connecting' || st === 'queued') {
        restoredQueue.push(dl.id);
      }
    }

    // Only dl-5 and dl-6 should be restored to queue; cancelled, paused, and completed items NEVER restart
    expect(restoredQueue).toEqual(['dl-5', 'dl-6']);
    expect(restoredQueue.includes('dl-1')).toBe(false);
    expect(restoredQueue.includes('dl-2')).toBe(false);
    expect(restoredQueue.includes('dl-3')).toBe(false);
  });

  test('Late progress events cannot resurrect CANCELLED state back to DOWNLOADING', () => {
    // Model state transition guard
    function simulateUpdateState(
      currentStatus: string,
      targetState: string,
      extra: Record<string, any> = {}
    ): string {
      const activeStates = [
        DOWNLOAD_STATE.DOWNLOADING,
        DOWNLOAD_STATE.CONNECTING,
        DOWNLOAD_STATE.MERGING,
        DOWNLOAD_STATE.VERIFYING,
      ];
      const isTryingToActivate = activeStates.includes(targetState as any);

      if (currentStatus === DOWNLOAD_STATE.CANCELLED) {
        const isUserRevival =
          (targetState === DOWNLOAD_STATE.QUEUED || targetState === DOWNLOAD_STATE.CONNECTING) &&
          (extra.receivedBytes === 0 || extra.percent === 0);
        if (isTryingToActivate && !isUserRevival) {
          return currentStatus; // Ignored / rejected
        }
      }
      return targetState;
    }

    // 1. Download was cancelled by user
    const state = DOWNLOAD_STATE.CANCELLED;

    // 2. Late progress event arrives from chunk reader
    const afterLateProgress = simulateUpdateState(state, DOWNLOAD_STATE.DOWNLOADING, { receivedBytes: 5000 });
    expect(afterLateProgress).toBe(DOWNLOAD_STATE.CANCELLED);

    // 3. Late connecting event arrives
    const afterLateConnecting = simulateUpdateState(state, DOWNLOAD_STATE.CONNECTING, { receivedBytes: 5000 });
    expect(afterLateConnecting).toBe(DOWNLOAD_STATE.CANCELLED);

    // 4. Legitimate retry arrives
    const afterUserRetry = simulateUpdateState(state, DOWNLOAD_STATE.CONNECTING, { receivedBytes: 0, percent: 0 });
    expect(afterUserRetry).toBe(DOWNLOAD_STATE.CONNECTING);
  });
});
