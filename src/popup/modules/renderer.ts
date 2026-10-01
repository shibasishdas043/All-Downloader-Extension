// ============================================================
//  All-Downloader — Popup DOM Renderer & Item Population
// ============================================================
import { DOWNLOAD_STATE, UI } from '../../shared/constants.js';
import {
  formatBytes, formatSpeed, formatHumanETA,
  truncateName, getExtension
} from '../../shared/utils.js';
import type { DownloadState } from '../../shared/types.js';
import { $list, $empty, $statusActive, $statusSpeed, $statusQueue, $tmpl } from './dom.js';
import { downloads, getAllDownloads } from './state.js';

export function renderAll(): void {
  const ACTIVE_STATES: DownloadState[] = [
    DOWNLOAD_STATE.QUEUED,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING,
  ] as DownloadState[];

  const isActive = (dl: any) => ACTIVE_STATES.includes(dl.status || dl.state);

  const sorted = getAllDownloads()
    .sort((a: any, b: any) => {
      const aActive = isActive(a);
      const bActive = isActive(b);
      if (aActive !== bActive) return aActive ? -1 : 1;
      if (aActive) return a.createdAt - b.createdAt;
      return b.createdAt - a.createdAt;
    })
    .slice(0, UI.POPUP_MAX_VISIBLE);

  const needed = new Set(sorted.map((dl: any) => dl.id));

  [...$list.querySelectorAll('.dl-item')].forEach((el: Element) => {
    const item = el as HTMLElement;
    if (!needed.has(item.dataset.id)) item.remove();
  });

  let refNode: ChildNode | null = $empty.nextSibling;

  for (const dl of sorted) {
    let el = $list.querySelector(`.dl-item[data-id="${dl.id}"]`) as HTMLElement | null;

    if (!el) {
      const node = $tmpl.content.cloneNode(true) as DocumentFragment;
      el = node.querySelector('.dl-item') as HTMLElement;
      el.dataset.id = dl.id;
      el.dataset.state = dl.state || dl.status;
      $list.insertBefore(node, refNode);
      el = $list.querySelector(`.dl-item[data-id="${dl.id}"]`) as HTMLElement;
    } else if (el !== refNode) {
      $list.insertBefore(el, refNode);
    }

    if (el) {
      populateItem(el, dl);
      refNode = el.nextSibling;
    }
  }

  $empty.style.display = sorted.length === 0 ? 'flex' : 'none';
  updateStatusBar();
}

export function updateItem(id: string): void {
  const el = $list.querySelector(`.dl-item[data-id="${id}"]`) as HTMLElement | null;
  if (!el) { renderAll(); return; }
  const dl = downloads[id];
  el.dataset.state = dl.state || dl.status;
  populateItem(el, dl);
  renderAll();
}

export function populateItem(el: HTMLElement, dl: any): void {
  const ext = getExtension(dl.filename);
  const badgeEl = el.querySelector('.dl-ext-badge') as HTMLElement;
  if (ext) {
    badgeEl.textContent = ext.slice(0, 4).toUpperCase();
  } else {
    badgeEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }
  (el.querySelector('.dl-name') as HTMLElement).textContent = truncateName(dl.filename, 30);

  const total = dl.total || dl.filesize || 0;
  const received = dl.received || dl.receivedBytes || 0;
  const st = dl.status || dl.state;

  let metaHtml = '';
  if (st === DOWNLOAD_STATE.COMPLETED) {
    const sizeVal = total > 0 ? total : (received > 0 ? received : (dl.fileSize || dl.filesize || 0));
    const size = sizeVal > 0 ? formatBytes(sizeVal) : '—';
    metaHtml = `<span>${size}</span><span class="dl-meta-dot">·</span><span class="dl-status-text completed">Completed</span>`;
  } else if (st === DOWNLOAD_STATE.CANCELLED) {
    const size = total > 0 ? formatBytes(total) : (received > 0 ? formatBytes(received) : '—');
    metaHtml = `<span>${size}</span><span class="dl-meta-dot">·</span><span class="dl-status-text cancelled">Cancelled</span>`;
  } else if (st === DOWNLOAD_STATE.ERROR) {
    const size = received > 0 ? formatBytes(received) : (total > 0 ? formatBytes(total) : '—');
    const errText = (dl.error || dl.errorMessage || '').toLowerCase();
    const failLabel = errText.includes('network') || errText.includes('connect') || errText.includes('fetch')
      ? 'Failed (Network error)'
      : 'Failed';
    metaHtml = `<span>${size}</span><span class="dl-meta-dot">·</span><span class="dl-status-text error">${failLabel}</span>`;
  } else {
    // Active states (downloading, paused, queued, connecting, merging, verifying):
    // only show size — status is already shown in the speed row below the progress bar
    const sizeStr = total > 0 ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
    metaHtml = `<span>${sizeStr}</span>`;
  }

  (el.querySelector('.dl-meta') as HTMLElement).innerHTML = metaHtml;

  const pct = dl.percent ?? dl.progress ?? 0;
  (el.querySelector('.dl-progress-fill') as HTMLElement).style.width = `${pct}%`;

  const stateBadgeLabels: Record<string, string> = {
    [DOWNLOAD_STATE.QUEUED]:     'Queued',
    [DOWNLOAD_STATE.CONNECTING]: 'Connecting',
    [DOWNLOAD_STATE.PAUSED]:     'Paused',
    [DOWNLOAD_STATE.COMPLETED]:  'Done',
    [DOWNLOAD_STATE.ERROR]:      'Error',
    [DOWNLOAD_STATE.CANCELLED]:  'Cancelled',
    [DOWNLOAD_STATE.MERGING]:    'Saving',
    [DOWNLOAD_STATE.VERIFYING]:  'Verifying',
  };

  const speedEl = el.querySelector('.dl-speed') as HTMLElement;
  const pctEl   = el.querySelector('.dl-percent') as HTMLElement;
  const etaEl   = el.querySelector('.dl-eta') as HTMLElement;

  if (st === DOWNLOAD_STATE.DOWNLOADING) {
    speedEl.textContent = formatSpeed(dl.speed);
    pctEl.textContent   = `${pct}%`;
    etaEl.textContent   = dl.eta ? `· ${formatHumanETA(dl.eta)}` : (dl.speed ? '· calculating…' : '');
  } else {
    speedEl.textContent = stateBadgeLabels[st] || '';
    pctEl.textContent   = `${pct}%`;
    etaEl.textContent   = '';
  }

  speedEl.classList.toggle('fast', (dl.speed || 0) > 1024 * 1024);

  const needsCancel = [
    DOWNLOAD_STATE.QUEUED, DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING, DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING, DOWNLOAD_STATE.VERIFYING,
  ].includes(st);

  const isCompleted = st === DOWNLOAD_STATE.COMPLETED;
  const isFailed    = st === DOWNLOAD_STATE.CANCELLED || st === DOWNLOAD_STATE.ERROR;
  const isActive    = st === DOWNLOAD_STATE.DOWNLOADING || st === DOWNLOAD_STATE.CONNECTING;
  const isPaused    = st === DOWNLOAD_STATE.PAUSED || st === DOWNLOAD_STATE.QUEUED;

  el.querySelector('.ctrl-pause')?.classList.toggle('hidden', !isActive);
  el.querySelector('.ctrl-resume')?.classList.toggle('hidden', !isPaused);
  el.querySelector('.ctrl-cancel')?.classList.toggle('hidden', !needsCancel);
  el.querySelector('.ctrl-folder')?.classList.toggle('hidden', !isCompleted);
  el.querySelector('.ctrl-retry')?.classList.toggle('hidden', !isFailed);
  el.querySelector('.ctrl-remove')?.classList.toggle('hidden', !(isCompleted || isFailed));
}

export function updateStatusBar(): void {
  const all = getAllDownloads();
  const active = all.filter(d => (d.status || d.state) === DOWNLOAD_STATE.DOWNLOADING);
  const queued = all.filter(d => (d.status || d.state) === DOWNLOAD_STATE.QUEUED);

  const totalSpeed = active.reduce((s, d) => s + (d.speed || 0), 0);

  $statusActive.textContent = `${active.length} active`;
  $statusSpeed.textContent  = formatSpeed(totalSpeed);
  $statusQueue.textContent  = `Queue: ${queued.length}`;
}
