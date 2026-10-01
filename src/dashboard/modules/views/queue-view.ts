// ============================================================
//  All-Downloader — Queue View & Scheduler Pipeline
// ============================================================
import { DOWNLOAD_STATE, MSG } from '../../../shared/constants.js';
import {
  formatBytes, relativeTime, truncateName,
  getExtension
} from '../../../shared/utils.js';
import { state } from '../state.js';
import { sendMsg } from '../api.js';
import { escHtml, updateSliderFill } from '../dom-helpers.js';
import { updateBadges } from '../sidebar.js';

export function renderQueue(): void {
  const list = document.getElementById('queue-list');
  if (!list) return;

  // Synchronize concurrency limit slider & value badge with active settings
  const qSlider = document.getElementById('q-max-concurrent') as HTMLInputElement | null;
  const qVal    = document.getElementById('q-max-val') as HTMLElement | null;
  if (qSlider && state.settings.maxConcurrent) {
    qSlider.value = String(state.settings.maxConcurrent);
    updateSliderFill(qSlider, qVal);
  }

  // Industry-grade queue order resolution:
  // 1. Primary order via latestQueueOrder array from QueueManager
  // 2. Stable fallback via createdAt ascending
  const queued = Object.values(state.downloads)
    .filter(d => d.state === DOWNLOAD_STATE.QUEUED)
    .sort((a, b) => {
      const idxA = state.latestQueueOrder.indexOf(a.id);
      const idxB = state.latestQueueOrder.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

  // Dynamic pipeline status badge
  const qBadge = document.getElementById('q-badge');
  if (qBadge) {
    qBadge.textContent = queued.length === 0
      ? 'Sequential FIFO (0)'
      : `${queued.length} ${queued.length === 1 ? 'item' : 'items'} • Sequential FIFO`;
  }

  list.innerHTML = '';

  if (queued.length === 0) {
    list.innerHTML = `
      <div class="queue-empty-state">
        <div class="q-empty-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <p class="q-empty-title">Queue is empty</p>
        <span class="q-empty-sub">Downloads scheduled beyond concurrency limits will line up here automatically.</span>
      </div>
    `;
    return;
  }

  const frag = document.createDocumentFragment();
  queued.forEach((dl, idx) => {
    const ext = getExtension(dl.filename);
    const badgeMarkup = ext
      ? ext.slice(0, 4).toUpperCase()
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    const div = document.createElement('div');
    div.className = 'q-item';
    div.dataset.id = dl.id;
    div.style.setProperty('--stagger', String(Math.min(idx, 20)));

    div.innerHTML = `
      <span class="q-rank">#${idx + 1}</span>
      <div class="file-ext-badge">${badgeMarkup}</div>
      <div class="q-details">
        <span class="q-title" title="${escHtml(dl.filename)}">${escHtml(truncateName(dl.filename, 48))}</span>
        <div class="q-meta">
          <span>${escHtml((dl.category || detectCategory(dl.filename, (dl as any).mimeType)).toUpperCase())}</span>
          <span class="q-meta-dot">•</span>
          <span>${dl.total > 0 ? formatBytes(dl.total) : 'Size unknown'}</span>
          <span class="q-meta-dot">•</span>
          <span>Added ${relativeTime(dl.createdAt)}</span>
        </div>
      </div>
      <div class="q-actions">
        ${idx > 0 ? `
          <button class="q-action-btn q-btn-boost" data-q-action="boost" data-id="${dl.id}" title="Boost to front of queue">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
          <button class="q-action-btn" data-q-action="move-up" data-id="${dl.id}" title="Move up">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,5 4,19 20,19"/></svg>
          </button>
        ` : ''}
        ${idx < queued.length - 1 ? `
          <button class="q-action-btn" data-q-action="move-down" data-id="${dl.id}" title="Move down">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,19 4,5 20,5"/></svg>
          </button>
        ` : ''}
        <button class="q-action-btn" data-q-action="start" data-id="${dl.id}" title="Start immediately">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        </button>
        <button class="q-action-btn q-btn-cancel" data-q-action="cancel" data-id="${dl.id}" title="Cancel & remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;

    frag.appendChild(div);
  });

  list.appendChild(frag);
}

export function bindQueue(): void {
  const qSlider = document.getElementById('q-max-concurrent') as HTMLInputElement | null;
  const qVal    = document.getElementById('q-max-val') as HTMLElement | null;

  if (qSlider) {
    qSlider.value = String(state.settings.maxConcurrent || 3);
    updateSliderFill(qSlider, qVal);

    qSlider.addEventListener('input', () => {
      updateSliderFill(qSlider, qVal);
      const val = Number(qSlider.value);
      state.settings.maxConcurrent = val;

      // Keep settings view slider in sync if rendered
      const setSlider = document.getElementById('setting-max-concurrent') as HTMLInputElement | null;
      const setVal = document.getElementById('val-max-concurrent') as HTMLElement | null;
      if (setSlider) {
        setSlider.value = String(val);
        updateSliderFill(setSlider, setVal);
      }

      clearTimeout(state.debounceQueueSliderTimer);
      state.debounceQueueSliderTimer = setTimeout(async () => {
        await sendMsg({ type: MSG.UPDATE_SETTINGS, payload: { maxConcurrent: val } });
      }, 120);
    });
  }

  // Event delegation on #queue-list
  const qList = document.getElementById('queue-list');
  if (qList) {
    qList.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('[data-q-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.qAction;
      const id = btn.dataset.id;
      if (!id) return;

      if (action === 'boost') {
        const res = await sendMsg({ type: MSG.PRIORITIZE_DOWNLOAD, id });
        if (res?.queueOrder) state.latestQueueOrder = res.queueOrder;
        renderQueue();
      } else if (action === 'move-up') {
        const res = await sendMsg({ type: MSG.MOVE_QUEUE_ITEM, id, direction: 'up' });
        if (res?.queueOrder) state.latestQueueOrder = res.queueOrder;
        renderQueue();
      } else if (action === 'move-down') {
        const res = await sendMsg({ type: MSG.MOVE_QUEUE_ITEM, id, direction: 'down' });
        if (res?.queueOrder) state.latestQueueOrder = res.queueOrder;
        renderQueue();
      } else if (action === 'start') {
        await sendMsg({ type: MSG.START_QUEUED_NOW, id });
        if (state.downloads[id]) state.downloads[id].state = DOWNLOAD_STATE.DOWNLOADING;
        renderQueue();
        updateBadges();
      } else if (action === 'cancel') {
        await sendMsg({ type: MSG.CANCEL_DOWNLOAD, id });
        if (state.downloads[id]) state.downloads[id].state = DOWNLOAD_STATE.CANCELLED;
        renderQueue();
        updateBadges();
      }
    });
  }
}
