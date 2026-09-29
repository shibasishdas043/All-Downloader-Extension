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

  // ── Auto-close if popup was opened automatically by a new download ───
  // The SW sets adl_autoOpened in session storage before calling openPopup().
  // If the flag is set, start a 3-second countdown; any user interaction
  // (mousemove or click) cancels the auto-close so the popup stays open.
  chrome.storage.session.get('adl_autoOpened', ({ adl_autoOpened }) => {
    if (!adl_autoOpened) return;
    chrome.storage.session.remove('adl_autoOpened');

    let autoCloseTimer = setTimeout(() => window.close(), 3000);

    const cancelAutoClose = () => {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
      document.removeEventListener('mousemove', cancelAutoClose);
      document.removeEventListener('mousedown', cancelAutoClose);
    };

    document.addEventListener('mousemove', cancelAutoClose);
    document.addEventListener('mousedown', cancelAutoClose);
  });

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
    if (btn.classList.contains('ctrl-cancel')) cancelDl(id);
    if (btn.classList.contains('ctrl-remove')) deleteDl(id);
    if (btn.classList.contains('ctrl-folder')) showInFolder(id);
    if (btn.classList.contains('ctrl-retry'))  retryDl(id);
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
        // Discard progress packets if user paused/cancelled/completed
        if ([DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.PAUSED].includes(downloads[msg.id].state)) {
          return;
        }
        // Allow MERGING state to flow through (it arrives tagged on the progress packet)
        const nextState = (msg.state === DOWNLOAD_STATE.MERGING)
          ? DOWNLOAD_STATE.MERGING
          : DOWNLOAD_STATE.DOWNLOADING;
        Object.assign(downloads[msg.id], {
          state:    nextState,
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
        if (msg.type === MSG.DOWNLOAD_ERROR) {
          downloads[msg.id].state = DOWNLOAD_STATE.ERROR;
          downloads[msg.id].error = msg.error;
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

function renderAll() {
  const ACTIVE_STATES = [
    DOWNLOAD_STATE.QUEUED,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING,
  ];

  const isActive = dl => ACTIVE_STATES.includes(dl.state);

  // Two-tier sort:
  //   Tier 1 — active downloads, oldest first (the one added first stays at top)
  //   Tier 2 — finished/cancelled/error, newest first (most recent history at top of that group)
  const sorted = Object.values(downloads)
    .sort((a, b) => {
      const aActive = isActive(a);
      const bActive = isActive(b);
      if (aActive !== bActive) return aActive ? -1 : 1;   // active always before finished
      if (aActive) return a.createdAt - b.createdAt;       // active: oldest first
      return b.createdAt - a.createdAt;                    // finished: newest first
    })
    .slice(0, UI.POPUP_MAX_VISIBLE);

  const needed = new Set(sorted.map(dl => dl.id));

  // Remove DOM items no longer in the visible set
  [...$list.querySelectorAll('.dl-item')].forEach(el => {
    if (!needed.has(el.dataset.id)) el.remove();
  });

  // Upsert + reorder: walk sorted array and make sure each item exists in DOM
  // in the correct position by moving/inserting relative to the previous sibling.
  let refNode = $empty.nextSibling ?? null;   // insert after the empty-state div

  for (const dl of sorted) {
    let el = $list.querySelector(`.dl-item[data-id="${dl.id}"]`);

    if (!el) {
      // Create new item
      const node = $tmpl.content.cloneNode(true);
      el = node.querySelector('.dl-item');
      el.dataset.id    = dl.id;
      el.dataset.state = dl.state;
      $list.insertBefore(node, refNode);
      // After insertBefore, the live node is the first child of $list matching id
      el = $list.querySelector(`.dl-item[data-id="${dl.id}"]`);
    } else if (el !== refNode) {
      // Already exists but in wrong position — move it
      $list.insertBefore(el, refNode);
    }

    populateItem(el, dl);
    refNode = el.nextSibling;
  }

  $empty.style.display = sorted.length === 0 ? 'flex' : 'none';
  updateStatusBar();
}

function appendItem(dl) {
  // Legacy helper kept for compatibility; renderAll handles insertion now.
  renderAll();
}

function updateItem(id) {
  const el = $list.querySelector(`.dl-item[data-id="${id}"]`);
  if (!el) { renderAll(); return; }
  const dl = downloads[id];
  el.dataset.state = dl.state;
  populateItem(el, dl);
  // Re-sort the full list so active downloads bubble to top after state changes
  // (e.g. a queued item becoming active, or active becoming completed).
  renderAll();
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
    [DOWNLOAD_STATE.MERGING]:    'Saving',
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

  // ── Button visibility — each button has one fixed role ──────────
  // States that need the cancel (×) button:
  // anything still in progress that can be stopped.
  const needsCancel = [
    DOWNLOAD_STATE.QUEUED, DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING, DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING, DOWNLOAD_STATE.VERIFYING,
  ].includes(dl.state);

  const isCompleted  = dl.state === DOWNLOAD_STATE.COMPLETED;
  const isFailed     = dl.state === DOWNLOAD_STATE.CANCELLED || dl.state === DOWNLOAD_STATE.ERROR;
  const isActive     = dl.state === DOWNLOAD_STATE.DOWNLOADING || dl.state === DOWNLOAD_STATE.CONNECTING;
  const isPaused     = dl.state === DOWNLOAD_STATE.PAUSED;

  el.querySelector('.ctrl-pause') .classList.toggle('hidden', !isActive);
  el.querySelector('.ctrl-resume').classList.toggle('hidden', !isPaused);
  el.querySelector('.ctrl-cancel').classList.toggle('hidden', !needsCancel);
  el.querySelector('.ctrl-folder').classList.toggle('hidden', !isCompleted);
  el.querySelector('.ctrl-retry') .classList.toggle('hidden', !isFailed);
  el.querySelector('.ctrl-remove').classList.toggle('hidden', !(isCompleted || isFailed));
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

async function retryDl(id) {
  if (downloads[id]) {
    downloads[id].state   = DOWNLOAD_STATE.QUEUED;
    downloads[id].error   = null;
    downloads[id].percent = 0;
    downloads[id].received = 0;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.RETRY_DOWNLOAD, id });
}

async function handleCancelOrRemove(id) {
  // Legacy safety — in the new design ctrl-cancel only cancels, ctrl-remove only deletes.
  // This function is kept in case it is called from other paths.
  const dl = downloads[id];
  if (!dl) return;
  await cancelDl(id);
}

async function showInFolder(id) {
  await sendMsg({ type: MSG.SHOW_IN_FOLDER, id });
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
