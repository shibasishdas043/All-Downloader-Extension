// ============================================================
//  All-Downloader — Popup Script (TypeScript)
// ============================================================
import { MSG, DOWNLOAD_STATE, UI } from '../shared/constants.js';
import {
  formatBytes, formatSpeed, formatETA,
  truncateName, getExtension,
  isValidUrl
} from '../shared/utils.js';
import type { DownloadItem, DownloadState } from '../shared/types.js';

// ─────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────
const downloads: Record<string, any> = {};

// ─────────────────────────────────────────────────────────────
//  DOM refs
// ─────────────────────────────────────────────────────────────
const $list = document.getElementById('download-list') as HTMLElement;
const $empty = document.getElementById('empty-state') as HTMLElement;
const $statusActive = document.getElementById('status-active') as HTMLElement;
const $statusSpeed = document.getElementById('status-speed') as HTMLElement;
const $statusQueue = document.getElementById('status-queue') as HTMLElement;
const $modalAdd = document.getElementById('modal-add') as HTMLElement;
const $urlInput = document.getElementById('url-input') as HTMLInputElement;
const $filenameInput = document.getElementById('filename-input') as HTMLInputElement;
const $tmpl = document.getElementById('tmpl-download-item') as HTMLTemplateElement;

// ─────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  const res = await sendMsg({ type: MSG.GET_DOWNLOADS });
  if (res?.downloads) {
    for (const dl of res.downloads) downloads[dl.id] = dl;
  }
  renderAll();

  if (chrome.storage && (chrome.storage as any).session) {
    (chrome.storage as any).session.get('adl_autoOpened', ({ adl_autoOpened }: { adl_autoOpened?: boolean }) => {
      if (!adl_autoOpened) return;
      (chrome.storage as any).session.remove('adl_autoOpened');

      let autoCloseTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => window.close(), 3000);

      const cancelAutoClose = () => {
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
        document.removeEventListener('mousemove', cancelAutoClose);
        document.removeEventListener('mousedown', cancelAutoClose);
      };

      document.addEventListener('mousemove', cancelAutoClose);
      document.addEventListener('mousedown', cancelAutoClose);
    });
  }

  chrome.runtime.onMessage.addListener(handleSWMessage);

  $list.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest('.ctrl-btn');
    if (!btn) return;
    const item = btn.closest('.dl-item') as HTMLElement | null;
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;

    if (btn.classList.contains('ctrl-pause'))  pauseDl(id);
    if (btn.classList.contains('ctrl-resume')) resumeDl(id);
    if (btn.classList.contains('ctrl-cancel')) cancelDl(id);
    if (btn.classList.contains('ctrl-remove')) deleteDl(id);
    if (btn.classList.contains('ctrl-folder')) showInFolder(id);
    if (btn.classList.contains('ctrl-retry'))  retryDl(id);
  });

  document.getElementById('btn-dashboard')?.addEventListener('click', openDashboard);
  document.getElementById('btn-add')?.addEventListener('click', showModal);
  document.getElementById('modal-close')?.addEventListener('click', hideModal);
  document.getElementById('btn-start-download')?.addEventListener('click', startManualDownload);
  document.getElementById('btn-pause-all')?.addEventListener('click', pauseAll);
  document.getElementById('btn-view-all')?.addEventListener('click', openDashboard);

  $modalAdd.addEventListener('click', (e: MouseEvent) => {
    if (e.target === $modalAdd) hideModal();
  });

  $urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') startManualDownload();
  });
}

// ─────────────────────────────────────────────────────────────
//  Message handler from SW
// ─────────────────────────────────────────────────────────────
function handleSWMessage(msg: any): void {
  switch (msg?.type) {
    case MSG.DOWNLOAD_ADDED:
      downloads[msg.download.id] = msg.download;
      renderAll();
      break;

    case MSG.DOWNLOAD_PROGRESS:
      if (downloads[msg.id]) {
        const curState = downloads[msg.id].state || downloads[msg.id].status;
        if ([DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.PAUSED].includes(curState)) {
          return;
        }
        const nextState = (msg.state === DOWNLOAD_STATE.MERGING)
          ? DOWNLOAD_STATE.MERGING
          : DOWNLOAD_STATE.DOWNLOADING;
        Object.assign(downloads[msg.id], {
          state:         nextState,
          status:        nextState,
          received:      msg.received,
          receivedBytes: msg.received,
          total:         msg.total,
          filesize:      msg.total,
          percent:       msg.percent,
          progress:      msg.percent,
          speed:         msg.speed,
          eta:           msg.eta,
        });
        updateItem(msg.id);
        updateStatusBar();
      }
      break;

    case MSG.DOWNLOAD_COMPLETED:
    case MSG.DOWNLOAD_PAUSED:
    case MSG.DOWNLOAD_CANCELLED:
    case MSG.DOWNLOAD_ERROR:
      if (downloads[msg.id]) {
        if (msg.type === MSG.DOWNLOAD_COMPLETED) {
          downloads[msg.id].state = DOWNLOAD_STATE.COMPLETED;
          downloads[msg.id].status = DOWNLOAD_STATE.COMPLETED;
        }
        if (msg.type === MSG.DOWNLOAD_PAUSED) {
          downloads[msg.id].state = DOWNLOAD_STATE.PAUSED;
          downloads[msg.id].status = DOWNLOAD_STATE.PAUSED;
        }
        if (msg.type === MSG.DOWNLOAD_CANCELLED) {
          downloads[msg.id].state = DOWNLOAD_STATE.CANCELLED;
          downloads[msg.id].status = DOWNLOAD_STATE.CANCELLED;
        }
        if (msg.type === MSG.DOWNLOAD_ERROR) {
          downloads[msg.id].state = DOWNLOAD_STATE.ERROR;
          downloads[msg.id].status = DOWNLOAD_STATE.ERROR;
          downloads[msg.id].error = msg.error;
          downloads[msg.id].errorMessage = msg.error;
        }
        updateItem(msg.id);
        updateStatusBar();
      }
      break;
  }
}

// ─────────────────────────────────────────────────────────────
//  Render helpers
// ─────────────────────────────────────────────────────────────

function renderAll(): void {
  const ACTIVE_STATES: DownloadState[] = [
    DOWNLOAD_STATE.QUEUED,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING,
  ] as DownloadState[];

  const isActive = (dl: any) => ACTIVE_STATES.includes(dl.status || dl.state);

  const sorted = Object.values(downloads)
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

function updateItem(id: string): void {
  const el = $list.querySelector(`.dl-item[data-id="${id}"]`) as HTMLElement | null;
  if (!el) { renderAll(); return; }
  const dl = downloads[id];
  el.dataset.state = dl.state || dl.status;
  populateItem(el, dl);
  renderAll();
}

function populateItem(el: HTMLElement, dl: any): void {
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
  const sizeStr = total > 0 ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
  (el.querySelector('.dl-meta') as HTMLElement).textContent = sizeStr;

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

  const st = dl.status || dl.state;
  if (st === DOWNLOAD_STATE.DOWNLOADING) {
    speedEl.textContent = formatSpeed(dl.speed);
    pctEl.textContent   = `${pct}%`;
    etaEl.textContent   = dl.eta ? `· ${formatETA(dl.eta)}` : '';
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
  const isPaused    = st === DOWNLOAD_STATE.PAUSED;

  el.querySelector('.ctrl-pause')?.classList.toggle('hidden', !isActive);
  el.querySelector('.ctrl-resume')?.classList.toggle('hidden', !isPaused);
  el.querySelector('.ctrl-cancel')?.classList.toggle('hidden', !needsCancel);
  el.querySelector('.ctrl-folder')?.classList.toggle('hidden', !isCompleted);
  el.querySelector('.ctrl-retry')?.classList.toggle('hidden', !isFailed);
  el.querySelector('.ctrl-remove')?.classList.toggle('hidden', !(isCompleted || isFailed));
}

function updateStatusBar(): void {
  const all = Object.values(downloads);
  const active = all.filter(d => (d.status || d.state) === DOWNLOAD_STATE.DOWNLOADING);
  const queued = all.filter(d => (d.status || d.state) === DOWNLOAD_STATE.QUEUED);

  const totalSpeed = active.reduce((s, d) => s + (d.speed || 0), 0);

  $statusActive.textContent = `${active.length} active`;
  $statusSpeed.textContent  = formatSpeed(totalSpeed);
  $statusQueue.textContent  = `Queue: ${queued.length}`;
}

// ─────────────────────────────────────────────────────────────
//  Actions
// ─────────────────────────────────────────────────────────────

async function pauseDl(id: string): Promise<void> {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.PAUSED;
    downloads[id].status = DOWNLOAD_STATE.PAUSED;
    downloads[id].speed = 0;
    downloads[id].eta = null;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.PAUSE_DOWNLOAD, id });
}

async function resumeDl(id: string): Promise<void> {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.CONNECTING;
    downloads[id].status = DOWNLOAD_STATE.CONNECTING;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.RESUME_DOWNLOAD, id });
}

async function cancelDl(id: string): Promise<void> {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.CANCELLED;
    downloads[id].status = DOWNLOAD_STATE.CANCELLED;
    downloads[id].speed = 0;
    downloads[id].eta = null;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.CANCEL_DOWNLOAD, id });
}

async function deleteDl(id: string): Promise<void> {
  delete downloads[id];
  document.querySelector(`.dl-item[data-id="${id}"]`)?.remove();
  const remaining = Object.values(downloads)
    .sort((a: any, b: any) => b.createdAt - a.createdAt)
    .slice(0, UI.POPUP_MAX_VISIBLE);
  $empty.style.display = remaining.length === 0 ? 'flex' : 'none';
  updateStatusBar();
  await sendMsg({ type: MSG.DELETE_DOWNLOAD, id });
}

async function retryDl(id: string): Promise<void> {
  if (downloads[id]) {
    downloads[id].state   = DOWNLOAD_STATE.QUEUED;
    downloads[id].status  = DOWNLOAD_STATE.QUEUED;
    downloads[id].error   = null;
    downloads[id].errorMessage = null;
    downloads[id].percent = 0;
    downloads[id].progress = 0;
    downloads[id].received = 0;
    downloads[id].receivedBytes = 0;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.RETRY_DOWNLOAD, id });
}

async function showInFolder(id: string): Promise<void> {
  await sendMsg({ type: MSG.SHOW_IN_FOLDER, id });
}

async function pauseAll(): Promise<void> {
  const active = Object.values(downloads).filter(d => (d.status || d.state) === DOWNLOAD_STATE.DOWNLOADING);
  for (const dl of active) await pauseDl(dl.id);
}

async function startManualDownload(): Promise<void> {
  const url = $urlInput.value.trim();
  if (!isValidUrl(url)) {
    $urlInput.style.borderColor = 'var(--orange)';
    $urlInput.focus();
    setTimeout(() => { $urlInput.style.borderColor = ''; }, 1500);
    return;
  }
  const filename = $filenameInput.value.trim() || undefined;
  hideModal();
  await sendMsg({ type: MSG.START_DOWNLOAD, payload: { url, filename } });
}

function openDashboard(): void {
  sendMsg({ type: MSG.OPEN_DASHBOARD });
  window.close();
}

function showModal(): void {
  $modalAdd.hidden = false;
  setTimeout(() => $urlInput.focus(), 50);
}

function hideModal(): void {
  $modalAdd.hidden = true;
  $urlInput.value = '';
  $filenameInput.value = '';
}

function sendMsg(msg: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res));
  });
}

init().catch(console.error);
