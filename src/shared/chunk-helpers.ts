// ============================================================
//  All-Downloader — Chunk Visualization Helpers
//  Standardized telemetry extraction & chunk rendering for UI
// ============================================================
import { formatBytes } from './utils.js';

export interface VisualChunk {
  index: number;
  start: number;
  end: number;
  length: number;
  received: number;
  percent: number;
  status: 'done' | 'downloading' | 'pending';
  statusText: string;
}

export function getVisualChunks(dl: any): VisualChunk[] {
  const total = dl.total || dl.filesize || dl.fileSize || 0;
  const received = dl.received || dl.receivedBytes || 0;
  const state = dl.state || dl.status || '';

  // 1. If live segments are available from download engine
  if (Array.isArray(dl.segments) && dl.segments.length > 0) {
    return dl.segments.map((s: any, i: number) => {
      const length = Math.max(1, (s.end - s.start + 1) || 1);
      const chunkRecv = Math.min(length, Math.max(0, s.received || 0));
      const percent = state === 'completed' ? 100 : Math.min(100, Math.round((chunkRecv / length) * 100));
      const done = s.done || percent === 100 || state === 'completed';
      const isDownloading = !done && state === 'downloading' && (chunkRecv > 0 || i === 0);

      const status: 'done' | 'downloading' | 'pending' = done
        ? 'done'
        : isDownloading
          ? 'downloading'
          : 'pending';

      const statusText = done
        ? 'Finished'
        : isDownloading
          ? 'Downloading'
          : (state === 'paused' ? 'Paused' : state === 'cancelled' ? 'Cancelled' : 'Waiting');

      return {
        index: i,
        start: s.start || 0,
        end: s.end || length,
        length,
        received: chunkRecv,
        percent,
        status,
        statusText,
      };
    });
  }

  // 2. Reconstruct chunks from totalChunks / size for completed, paused, cancelled, or legacy items
  let numChunks = dl.totalChunks || dl.chunkCount || 0;
  if (!numChunks || numChunks <= 0) {
    if (total > 2 * 1024 * 1024) {
      numChunks = Math.min(8, Math.max(2, Math.floor(total / (512 * 1024))));
    } else {
      numChunks = 1;
    }
  }

  const chunkSize = total > 0 ? Math.ceil(total / numChunks) : 0;
  const chunks: VisualChunk[] = [];

  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = total > 0 ? Math.min(start + chunkSize - 1, total - 1) : 0;
    const length = Math.max(1, end - start + 1);
    let chunkRecv = 0;

    if (state === 'completed') {
      chunkRecv = length;
    } else if (total > 0 && received > 0) {
      chunkRecv = Math.min(length, Math.max(0, received - start));
    }

    const percent = state === 'completed' ? 100 : (total > 0 ? Math.min(100, Math.round((chunkRecv / length) * 100)) : 0);
    const done = percent === 100 || state === 'completed';
    const isDownloading = !done && state === 'downloading' && chunkRecv > 0;

    const status: 'done' | 'downloading' | 'pending' = done
      ? 'done'
      : isDownloading
        ? 'downloading'
        : 'pending';

    const statusText = done
      ? 'Finished'
      : isDownloading
        ? 'Downloading'
        : (state === 'paused' ? 'Paused' : state === 'cancelled' ? 'Cancelled' : 'Waiting');

    chunks.push({
      index: i,
      start,
      end,
      length,
      received: chunkRecv,
      percent,
      status,
      statusText,
    });
  }

  return chunks;
}

export function renderChunkDrawerHtml(dl: any): string {
  const chunks = getVisualChunks(dl);
  const state = dl.state || dl.status || '';
  const isDone = state === 'completed';
  const finishedCount = chunks.filter(c => c.status === 'done').length;
  const isAllDone = isDone || (chunks.length > 0 && finishedCount === chunks.length);

  return `
    <div class="chunk-drawer-content" data-drawer-id="${dl.id}">
      <div class="chunk-drawer-header">
        <span class="chunk-title-badge">${chunks.length} CHUNKS</span>
        <span class="chunk-done-status ${isAllDone ? 'all-done' : ''}">${finishedCount}/${chunks.length} Done</span>
      </div>

      <!-- Segmented Multi-Bar Track -->
      <div class="chunk-track-strip">
        ${chunks.map(c => `
          <div class="chunk-strip-seg ${c.status}" style="flex: ${c.length}" title="Chunk ${c.index + 1}: ${c.percent}% (${formatBytes(c.received)} / ${formatBytes(c.length)})">
            <div class="chunk-seg-fill" style="width: ${c.percent}%"></div>
          </div>
        `).join('')}
      </div>

      <!-- Detailed Threads / Segments Grid -->
      <div class="chunk-threads-grid">
        ${chunks.map(c => `
          <div class="chunk-card ${c.status}">
            <div class="chunk-card-top">
              <span class="chunk-card-num">Thread ${c.index + 1}</span>
              <span class="chunk-card-pct">${c.percent}%</span>
            </div>
            <div class="chunk-mini-bar">
              <div class="chunk-mini-fill" style="width: ${c.percent}%"></div>
            </div>
            <div class="chunk-card-range">${formatBytes(c.start)} – ${formatBytes(c.end)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
