// ============================================================
//  All-Downloader — Queue Manager
//  Priority queue + concurrency limiter + scheduler
// ============================================================
import { DOWNLOAD_STATE } from '../shared/constants.js';

export class QueueManager {
  /**
   * @param {object} options
   * @param {number} options.maxConcurrent  Max parallel downloads
   * @param {Function} options.onDequeue    Called when a queued download should start
   */
  constructor({ maxConcurrent = 3, onDequeue } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.onDequeue     = onDequeue;
    /** @type {string[]} IDs currently running */
    this.running       = new Set();
    /** @type {string[]} Ordered queue of IDs */
    this.queue         = [];
    /** @type {Map<string, number>} Scheduled alarms: downloadId → alarm timestamp */
    this.scheduled     = new Map();
  }

  // ── Configuration ─────────────────────────────────────────

  setMaxConcurrent(n) {
    this.maxConcurrent = Math.max(1, n);
    this._flush();
  }

  // ── Queue Operations ───────────────────────────────────────

  /**
   * Enqueue a download. If slots are free, starts immediately.
   * @param {string} downloadId
   * @param {number|null} scheduledAt  Unix ms timestamp to delay start
   */
  enqueue(downloadId, scheduledAt = null) {
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
   * @param {string} downloadId
   */
  markRunning(downloadId) {
    this.running.add(downloadId);
    const idx = this.queue.indexOf(downloadId);
    if (idx !== -1) this.queue.splice(idx, 1);
  }

  /**
   * Mark a download as finished / paused / cancelled.
   * Frees a slot and triggers next in queue.
   * @param {string} downloadId
   */
  markDone(downloadId) {
    this.running.delete(downloadId);
    this._flush();
  }

  /**
   * Remove from queue (cancel queued-but-not-started).
   * @param {string} downloadId
   */
  remove(downloadId) {
    this.running.delete(downloadId);
    const idx = this.queue.indexOf(downloadId);
    if (idx !== -1) this.queue.splice(idx, 1);
    this._cancelAlarm(downloadId);
  }

  /**
   * Move a download to the front of the queue (priority boost).
   * @param {string} downloadId
   */
  prioritize(downloadId) {
    const idx = this.queue.indexOf(downloadId);
    if (idx > 0) {
      this.queue.splice(idx, 1);
      this.queue.unshift(downloadId);
    }
    this._flush();
  }

  /**
   * Move a download up or down in the queue sequence.
   * @param {string} downloadId
   * @param {'up'|'down'} direction
   * @returns {boolean} Whether the item was moved
   */
  move(downloadId, direction) {
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
   * @returns {string[]} Cleared download IDs
   */
  clear() {
    const cleared = [...this.queue];
    this.queue = [];
    return cleared;
  }

  // ── Introspection ──────────────────────────────────────────

  isRunning(downloadId) { return this.running.has(downloadId); }
  isQueued(downloadId)  { return this.queue.includes(downloadId); }
  getQueueLength()      { return this.queue.length; }
  getRunningCount()     { return this.running.size; }
  hasFreeSlot()         { return this.running.size < this.maxConcurrent; }

  /** Full status snapshot for debugging / dashboard display */
  getStatus() {
    return {
      running:       [...this.running],
      queue:         [...this.queue],
      maxConcurrent: this.maxConcurrent,
    };
  }

  // ── Scheduling (chrome.alarms) ─────────────────────────────

  /**
   * Register a chrome.alarms alarm to start a download at a specific time.
   * @param {string} downloadId
   * @param {number} atMs  Unix timestamp in ms
   */
  _scheduleAlarm(downloadId, atMs) {
    const name = `adl_sched_${downloadId}`;
    chrome.alarms.create(name, { when: atMs });
    this.scheduled.set(downloadId, atMs);
  }

  _cancelAlarm(downloadId) {
    const name = `adl_sched_${downloadId}`;
    chrome.alarms.clear(name);
    this.scheduled.delete(downloadId);
  }

  /**
   * Called from service-worker when chrome.alarms fires.
   * @param {string} alarmName
   */
  handleAlarm(alarmName) {
    if (!alarmName.startsWith('adl_sched_')) return;
    const downloadId = alarmName.replace('adl_sched_', '');
    this.scheduled.delete(downloadId);
    this.enqueue(downloadId, null);
  }

  // ── Internal flush ─────────────────────────────────────────

  _flush() {
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const next = this.queue.shift();
      this.running.add(next);
      // Notify the service worker to actually start this download
      if (typeof this.onDequeue === 'function') {
        this.onDequeue(next);
      }
    }
  }
}
