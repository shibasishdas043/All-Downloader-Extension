// ============================================================
//  All-Downloader — Queue Manager (TypeScript)
//  Priority queue + concurrency limiter + scheduler
// ============================================================

export interface QueueManagerOptions {
  maxConcurrent?: number;
  onDequeue?: (downloadId: string) => void;
}

export interface QueueSnapshot {
  running: string[];
  queue: string[];
  maxConcurrent: number;
}

export class QueueManager {
  private maxConcurrent: number;
  private onDequeue?: (downloadId: string) => void;
  private running: Set<string>;
  private queue: string[];
  private scheduled: Map<string, number>;

  constructor({ maxConcurrent = 3, onDequeue }: QueueManagerOptions = {}) {
    this.maxConcurrent = maxConcurrent;
    this.onDequeue = onDequeue;
    this.running = new Set();
    this.queue = [];
    this.scheduled = new Map();
  }

  // ── Configuration ─────────────────────────────────────────

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(1, n);
    this._flush();
  }

  // ── Queue Operations ───────────────────────────────────────

  /**
   * Enqueue a download. If slots are free, starts immediately.
   */
  enqueue(downloadId: string, scheduledAt: number | null = null): void {
    if (scheduledAt && scheduledAt > Date.now()) {
      // Deferred — register a chrome.alarms entry
      this._scheduleAlarm(downloadId, scheduledAt);
      return;
    }
    if (!this.queue.includes(downloadId)) {
      this.queue.push(downloadId);
    }
    this._flush();
  }

  /**
   * Mark a download as started (running).
   */
  markRunning(downloadId: string): void {
    this.running.add(downloadId);
    const idx = this.queue.indexOf(downloadId);
    if (idx !== -1) this.queue.splice(idx, 1);
  }

  /**
   * Mark a download as finished / paused / cancelled.
   * Frees a slot and triggers next in queue.
   */
  markDone(downloadId: string): void {
    this.running.delete(downloadId);
    this._flush();
  }

  /**
   * Remove from queue (cancel queued-but-not-started).
   */
  remove(downloadId: string): void {
    this.running.delete(downloadId);
    const idx = this.queue.indexOf(downloadId);
    if (idx !== -1) this.queue.splice(idx, 1);
    this._cancelAlarm(downloadId);
  }

  /**
   * Move a download to the front of the queue (priority boost).
   */
  prioritize(downloadId: string): void {
    const idx = this.queue.indexOf(downloadId);
    if (idx > 0) {
      this.queue.splice(idx, 1);
      this.queue.unshift(downloadId);
    }
    this._flush();
  }

  /**
   * Move a download up or down in the queue sequence.
   */
  move(downloadId: string, direction: 'up' | 'down'): boolean {
    const idx = this.queue.indexOf(downloadId);
    if (idx === -1) return false;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx >= 0 && targetIdx < this.queue.length) {
      this.queue.splice(idx, 1);
      this.queue.splice(targetIdx, 0, downloadId);
      return true;
    }
    return false;
  }

  /**
   * Remove and return all items in the waiting queue.
   */
  clear(): string[] {
    const cleared = [...this.queue];
    this.queue = [];
    return cleared;
  }

  // ── Introspection ──────────────────────────────────────────

  isRunning(downloadId: string): boolean {
    return this.running.has(downloadId);
  }

  isQueued(downloadId: string): boolean {
    return this.queue.includes(downloadId);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getRunningCount(): number {
    return this.running.size;
  }

  hasFreeSlot(): boolean {
    return this.running.size < this.maxConcurrent;
  }

  /** Full status snapshot for debugging / dashboard display */
  getStatus(): QueueSnapshot {
    return {
      running: [...this.running],
      queue: [...this.queue],
      maxConcurrent: this.maxConcurrent,
    };
  }

  // ── Scheduling (chrome.alarms) ─────────────────────────────

  private _scheduleAlarm(downloadId: string, atMs: number): void {
    const name = `adl_sched_${downloadId}`;
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.create(name, { when: atMs });
    }
    this.scheduled.set(downloadId, atMs);
  }

  private _cancelAlarm(downloadId: string): void {
    const name = `adl_sched_${downloadId}`;
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear(name);
    }
    this.scheduled.delete(downloadId);
  }

  handleAlarm(alarmName: string): void {
    if (!alarmName.startsWith('adl_sched_')) return;
    const downloadId = alarmName.replace('adl_sched_', '');
    this.scheduled.delete(downloadId);
    this.enqueue(downloadId, null);
  }

  // ── Internal flush ─────────────────────────────────────────

  private _flush(): void {
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const next = this.queue.shift();
      if (!next) break;
      this.running.add(next);
      if (typeof this.onDequeue === 'function') {
        this.onDequeue(next);
      }
    }
  }
}
