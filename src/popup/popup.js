// ============================================================
//  All-Downloader — Popup Script
// ============================================================
import { MSG, DOWNLOAD_STATE, UI } from '../shared/constants.js';
import {
  formatBytes, formatSpeed, formatETA,
  truncateName, getExtension, calcPercent,
  isValidUrl
} from '../shared/utils.js';

// ─────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────
let downloads = {};   // { [id]: downloadObject }

// ─────────────────────────────────────────────────────────────
//  DOM refs
// ─────────────────────────────────────────────────────────────
const $list      = document.getElementById('download-list');
const $empty     = document.getElementById('empty-state');
const $statusActive = document.getElementById('status-active');
const $statusSpeed  = document.getElementById('status-speed');
const $statusQueue  = document.getElementById('status-queue');
const $modalAdd  = document.getElementById('modal-add');
const $urlInput  = document.getElementById('url-input');
const $filenameInput = document.getElementById('filename-input');
const $tmpl      = document.getElementById('tmpl-download-item');

// ─────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────
async function init() {
  // Load initial state from service worker
  const res = await sendMsg({ type: MSG.GET_DOWNLOADS });
  if (res?.downloads) {
    for (const dl of res.downloads) downloads[dl.id] = dl;
  }
  renderAll();

  // Listen for live updates from SW
  chrome.runtime.onMessage.addListener(handleSWMessage);

  // Delegated click handling for download items
  $list.addEventListener('click', (e) => {
    const btn = e.target.closest('.ctrl-btn');
    if (!btn) return;
    const item = btn.closest('.dl-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;

    if (btn.classList.contains('ctrl-pause'))  pauseDl(id);
    if (btn.classList.contains('ctrl-resume')) resumeDl(id);
    if (btn.classList.contains('ctrl-cancel')) handleCancelOrRemove(id);
  });

  // Button bindings
  document.getElementById('btn-dashboard').addEventListener('click', openDashboard);
  document.getElementById('btn-add').addEventListener('click', showModal);
  document.getElementById('modal-close').addEventListener('click', hideModal);
  document.getElementById('btn-start-download').addEventListener('click', startManualDownload);
  document.getElementById('btn-pause-all').addEventListener('click', pauseAll);
  document.getElementById('btn-view-all').addEventListener('click', openDashboard);

  // Close modal on backdrop click
  $modalAdd.addEventListener('click', (e) => {
    if (e.target === $modalAdd) hideModal();
  });

  // Enter key in URL input
  $urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startManualDownload();
  });
}

// ─────────────────────────────────────────────────────────────
//  Message handler from SW
// ─────────────────────────────────────────────────────────────
function handleSWMessage(msg) {
  switch (msg.type) {
    case MSG.DOWNLOAD_ADDED:
      downloads[msg.download.id] = msg.download;
      renderAll();
      break;

    case MSG.DOWNLOAD_PROGRESS:
      if (downloads[msg.id]) {
        // Discard incoming progress packets if user paused/cancelled/completed
        if ([DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.PAUSED].includes(downloads[msg.id].state)) {
          return;
        }
        Object.assign(downloads[msg.id], {
          state:    DOWNLOAD_STATE.DOWNLOADING,
          received: msg.received,
          total:    msg.total,
          percent:  msg.percent,
          speed:    msg.speed,
          eta:      msg.eta,
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
        if (msg.type === MSG.DOWNLOAD_COMPLETED)  downloads[msg.id].state = DOWNLOAD_STATE.COMPLETED;
        if (msg.type === MSG.DOWNLOAD_PAUSED)     downloads[msg.id].state = DOWNLOAD_STATE.PAUSED;
        if (msg.type === MSG.DOWNLOAD_CANCELLED)  downloads[msg.id].state = DOWNLOAD_STATE.CANCELLED;
        if (msg.type === MSG.DOWNLOAD_ERROR)      downloads[msg.id].state = DOWNLOAD_STATE.ERROR;
        updateItem(msg.id);
        updateStatusBar();
      }
      break;
  }
}

// ─────────────────────────────────────────────────────────────
//  Render helpers
// ─────────────────────────────────────────────────────────────

function renderAll() {
  // Show only up to UI.POPUP_MAX_VISIBLE most recent active-ish downloads
  const sorted = Object.values(downloads)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, UI.POPUP_MAX_VISIBLE);

  const existing = new Set([...$list.querySelectorAll('.dl-item')].map(el => el.dataset.id));
  const needed   = new Set(sorted.map(dl => dl.id));

  // Remove items no longer needed
  for (const id of existing) {
    if (!needed.has(id)) {
      document.querySelector(`.dl-item[data-id="${id}"]`)?.remove();
    }
  }

  // Add or update
  for (const dl of sorted) {
    if (!existing.has(dl.id)) {
      appendItem(dl);
    } else {
      updateItem(dl.id);
    }
  }

  $empty.style.display = sorted.length === 0 ? 'flex' : 'none';
  updateStatusBar();
}

function appendItem(dl) {
  const node = $tmpl.content.cloneNode(true);
  const el   = node.querySelector('.dl-item');
  el.dataset.id    = dl.id;
  el.dataset.state = dl.state;

  $list.insertBefore(node, $list.firstChild);
  populateItem(el, dl);
}

function updateItem(id) {
  const el = $list.querySelector(`.dl-item[data-id="${id}"]`);
  if (!el) return;
  const dl = downloads[id];
  el.dataset.state = dl.state;
  populateItem(el, dl);
}

function populateItem(el, dl) {
  const ext = getExtension(dl.filename);
  const badgeEl = el.querySelector('.dl-ext-badge');
  if (ext) {
    badgeEl.textContent = ext.slice(0, 4).toUpperCase();
  } else {
    badgeEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }
  el.querySelector('.dl-name').textContent = truncateName(dl.filename, 30);

  // Size meta
  const sizeStr = dl.total > 0 ? `${formatBytes(dl.received)} / ${formatBytes(dl.total)}` : formatBytes(dl.received);
  el.querySelector('.dl-meta').textContent = sizeStr;

  // Progress
  const pct = dl.percent || 0;
  el.querySelector('.dl-progress-fill').style.width = `${pct}%`;

  // State mapping
  const stateBadgeLabels = {
    [DOWNLOAD_STATE.QUEUED]:     'Queued',
    [DOWNLOAD_STATE.CONNECTING]: 'Connecting',
    [DOWNLOAD_STATE.PAUSED]:     'Paused',
    [DOWNLOAD_STATE.COMPLETED]:  'Done',
    [DOWNLOAD_STATE.ERROR]:      'Error',
    [DOWNLOAD_STATE.CANCELLED]:  'Cancelled',
    [DOWNLOAD_STATE.MERGING]:    'Merging',
    [DOWNLOAD_STATE.VERIFYING]:  'Verifying',
  };

  // Telemetry labels
  const speedEl = el.querySelector('.dl-speed');
  const pctEl   = el.querySelector('.dl-percent');
  const etaEl   = el.querySelector('.dl-eta');

  if (dl.state === DOWNLOAD_STATE.DOWNLOADING) {
    speedEl.textContent = formatSpeed(dl.speed);
    pctEl.textContent   = `${pct}%`;
    etaEl.textContent   = dl.eta ? `· ${formatETA(dl.eta)}` : '';
  } else {
    speedEl.textContent = stateBadgeLabels[dl.state] || '';
    pctEl.textContent   = `${pct}%`;
    etaEl.textContent   = '';
  }



  // Speed class
  speedEl.classList.toggle('fast', dl.speed > 1024 * 1024); // > 1 MB/s

  // Pause / Resume visibility
  const isActive = dl.state === DOWNLOAD_STATE.DOWNLOADING || dl.state === DOWNLOAD_STATE.CONNECTING;
  const isPaused = dl.state === DOWNLOAD_STATE.PAUSED;
  el.querySelector('.ctrl-pause').classList.toggle('hidden', !isActive);
  el.querySelector('.ctrl-resume').classList.toggle('hidden', !isPaused);

  // Cancel or Remove button
  const isRemovable = [DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.ERROR].includes(dl.state);
  const cancelBtn = el.querySelector('.ctrl-cancel');
  cancelBtn.style.opacity = '1';
  cancelBtn.style.pointerEvents = 'auto';
  if (isRemovable) {
    cancelBtn.title = 'Remove from list';
    cancelBtn.classList.add('ctrl-remove');
    cancelBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  } else {
    cancelBtn.title = 'Cancel download';
    cancelBtn.classList.remove('ctrl-remove');
    cancelBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  }
}

function updateStatusBar() {
  const all = Object.values(downloads);
  const active = all.filter(d => d.state === DOWNLOAD_STATE.DOWNLOADING);
  const queued = all.filter(d => d.state === DOWNLOAD_STATE.QUEUED);

  const totalSpeed = active.reduce((s, d) => s + (d.speed || 0), 0);

  $statusActive.textContent = `${active.length} active`;
  $statusSpeed.textContent  = formatSpeed(totalSpeed);
  $statusQueue.textContent  = `Queue: ${queued.length}`;
}

// ─────────────────────────────────────────────────────────────
//  Actions
// ─────────────────────────────────────────────────────────────

async function pauseDl(id) {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.PAUSED;
    downloads[id].speed = 0;
    downloads[id].eta = null;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.PAUSE_DOWNLOAD, id });
}

async function resumeDl(id) {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.CONNECTING;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.RESUME_DOWNLOAD, id });
}

async function cancelDl(id) {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.CANCELLED;
    downloads[id].speed = 0;
    downloads[id].eta = null;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.CANCEL_DOWNLOAD, id });
}

async function deleteDl(id) {
  delete downloads[id];
  document.querySelector(`.dl-item[data-id="${id}"]`)?.remove();
  const remaining = Object.values(downloads)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, UI.POPUP_MAX_VISIBLE);
  $empty.style.display = remaining.length === 0 ? 'flex' : 'none';
  updateStatusBar();
  await sendMsg({ type: MSG.DELETE_DOWNLOAD, id });
}

async function handleCancelOrRemove(id) {
  const dl = downloads[id];
  if (!dl) return;
  const isRemovable = [DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.ERROR].includes(dl.state);
  if (isRemovable) {
    await deleteDl(id);
  } else {
    await cancelDl(id);
  }
}

async function pauseAll() {
  const active = Object.values(downloads).filter(d => d.state === DOWNLOAD_STATE.DOWNLOADING);
  for (const dl of active) await pauseDl(dl.id);
}

async function startManualDownload() {
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

function openDashboard() {
  sendMsg({ type: MSG.OPEN_DASHBOARD });
  window.close();
}

function showModal() {
  $modalAdd.hidden = false;
  setTimeout(() => $urlInput.focus(), 50);
}

function hideModal() {
  $modalAdd.hidden = true;
  $urlInput.value = '';
  $filenameInput.value = '';
}

// ─────────────────────────────────────────────────────────────
//  Messaging helper
// ─────────────────────────────────────────────────────────────
function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res));
  });
}

// ─────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────
init().catch(console.error);
