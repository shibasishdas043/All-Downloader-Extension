// ============================================================
//  All-Downloader — Dashboard Script
// ============================================================
import { MSG, DOWNLOAD_STATE, DEFAULT_SETTINGS, FILE_CATEGORY } from '../shared/constants.js';
import {
  formatBytes, formatSpeed, formatETA,
  truncateName, getExtension, calcPercent,
  relativeTime, isValidUrl, detectCategory
} from '../shared/utils.js';

// ─────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────
let downloads = {};
let settings  = { ...DEFAULT_SETTINGS };
let stats     = {};

let currentView   = 'downloads';
let activeFilter  = 'all';
let activeCat     = 'all';
let searchQuery   = '';
let sortCol       = 'createdAt';
let sortDir       = 'desc';
let selected      = new Set();
let latestQueueOrder = [];
let debounceQueueSliderTimer = null;
let histSortCol = 'time';
let histSortDir = 'desc';

// High-performance RAF throttle queues (Zero GC pressure)
const pendingProgressIds = new Set();
let rafScheduled = false;

// ─────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────
async function init() {
  // Load all data
  const [dlRes, setRes] = await Promise.all([
    sendMsg({ type: MSG.GET_DOWNLOADS }),
    sendMsg({ type: MSG.GET_SETTINGS }),
  ]);

  if (dlRes?.downloads)  dlRes.downloads.forEach(d => downloads[d.id] = d);
  if (dlRes?.queueOrder) latestQueueOrder = dlRes.queueOrder;
  if (setRes?.settings)  settings = setRes.settings;

  // Listen for live updates
  chrome.runtime.onMessage.addListener(handleSWMessage);

  bindNav();
  bindTopbar();
  bindFilters();
  bindModal();
  bindSettings();
  bindQueue();
  bindHistory();
  bindBulkActions();
  bindTableDelegation();

  updateSidebarStats();
  updateBadges();

  renderView('downloads');
}

// ─────────────────────────────────────────────────────────────
//  Live message handling
// ─────────────────────────────────────────────────────────────
function handleSWMessage(msg) {
  switch (msg.type) {
    case MSG.DOWNLOAD_ADDED:
      downloads[msg.download.id] = msg.download;
      if (currentView === 'downloads') renderDownloadsTable();
      updateSidebarStats();
      updateBadges();
      break;

    case MSG.DOWNLOAD_PROGRESS:
      if (!downloads[msg.id]) {
        downloads[msg.id] = {
          id: msg.id,
          state: DOWNLOAD_STATE.DOWNLOADING,
          received: msg.received, total: msg.total,
          percent: msg.percent, speed: msg.speed, eta: msg.eta,
        };
        if (currentView === 'downloads') renderDownloadsTable();
      } else {
        Object.assign(downloads[msg.id], {
          state: DOWNLOAD_STATE.DOWNLOADING,
          received: msg.received, total: msg.total,
          percent: msg.percent, speed: msg.speed, eta: msg.eta,
        });
        queueProgressUpdate(msg.id);
      }
      break;

    case MSG.DOWNLOAD_COMPLETED:
    case MSG.DOWNLOAD_PAUSED:
    case MSG.DOWNLOAD_CANCELLED:
    case MSG.DOWNLOAD_ERROR:
      if (downloads[msg.id]) {
        if (msg.type === MSG.DOWNLOAD_COMPLETED) downloads[msg.id].state = DOWNLOAD_STATE.COMPLETED;
        if (msg.type === MSG.DOWNLOAD_PAUSED)    downloads[msg.id].state = DOWNLOAD_STATE.PAUSED;
        if (msg.type === MSG.DOWNLOAD_CANCELLED) downloads[msg.id].state = DOWNLOAD_STATE.CANCELLED;
        if (msg.type === MSG.DOWNLOAD_ERROR) {
          downloads[msg.id].state = DOWNLOAD_STATE.ERROR;
          if (msg.error) downloads[msg.id].error = msg.error;
        }
        updateTableRowState(msg.id);
        updateSidebarStats();
        updateBadges();
        if (currentView === 'history' && [MSG.DOWNLOAD_COMPLETED, MSG.DOWNLOAD_CANCELLED, MSG.DOWNLOAD_ERROR].includes(msg.type)) renderHistory();
        if (currentView === 'queue') renderQueue();
        if (currentView === 'stats') renderStats();
      }
      break;
  }
}

// ─────────────────────────────────────────────────────────────
//  High-Performance Batched DOM Updates (Zero layout thrashing)
// ─────────────────────────────────────────────────────────────
function queueProgressUpdate(id) {
  pendingProgressIds.add(id);
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(flushProgressUpdates);
  }
}

function flushProgressUpdates() {
  rafScheduled = false;
  if (currentView !== 'downloads') {
    pendingProgressIds.clear();
    updateSidebarStats();
    return;
  }

  const tbody = document.getElementById('dl-tbody');
  if (!tbody) {
    pendingProgressIds.clear();
    return;
  }

  for (const id of pendingProgressIds) {
    const dl = downloads[id];
    if (!dl) continue;
    const tr = tbody.querySelector(`tr[data-id="${id}"]`);
    if (!tr) continue;

    // Mutate only changed text & styles in-place
    const fill = tr.querySelector('.tbl-progress-fill');
    if (fill) fill.style.width = `${dl.percent || 0}%`;

    const label = tr.querySelector('.tbl-progress-label');
    if (label) label.textContent = `${dl.percent || 0}%`;

    const sizeCell = tr.querySelector('.col-size');
    if (sizeCell && dl.total > 0) sizeCell.textContent = formatBytes(dl.total);

    const speed = tr.querySelector('.speed-cell');
    if (speed) speed.textContent = dl.state === DOWNLOAD_STATE.DOWNLOADING ? formatSpeed(dl.speed) : '—';

    const eta = tr.querySelector('.col-eta');
    if (eta) eta.textContent = (dl.state === DOWNLOAD_STATE.DOWNLOADING && dl.eta) ? formatETA(dl.eta) : '—';

    const statusCol = tr.querySelector('.col-status');
    if (statusCol && statusCol.dataset.state !== dl.state) {
      statusCol.dataset.state = dl.state;
      statusCol.innerHTML = buildStateBadge(dl.state);
    }
  }

  pendingProgressIds.clear();
  updateSidebarStats();
}

// ─────────────────────────────────────────────────────────────
//  Navigation
// ─────────────────────────────────────────────────────────────
function bindNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderView(view);
    });
  });
}

function renderView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');

  const titles = {
    downloads: ['Downloads', 'All active & recent'],
    queue:     ['Queue', 'Manage download order & scheduling'],
    history:   ['History', 'Completed & past downloads'],
    stats:     ['Statistics', 'Lifetime download analytics'],
    settings:  ['Settings', 'Configure All Downloader'],
  };

  const [title, sub] = titles[view] || ['Dashboard', ''];
  document.getElementById('page-title').textContent    = title;
  document.getElementById('page-subtitle').textContent = sub;

  if (view === 'downloads') renderDownloadsTable();
  if (view === 'history')   renderHistory();
  if (view === 'stats')     renderStats();
  if (view === 'settings')  loadSettingsUI();
  if (view === 'queue')     renderQueue();
}

// ─────────────────────────────────────────────────────────────
//  Downloads Table Logic & Algorithms
// ─────────────────────────────────────────────────────────────
function getFilteredDownloads() {
  let list = Object.values(downloads);

  // 1. State Filter (Complete State Coverage)
  if (activeFilter !== 'all') {
    if (activeFilter === 'downloading' || activeFilter === 'active') {
      const activeStates = [
        DOWNLOAD_STATE.DOWNLOADING,
        DOWNLOAD_STATE.CONNECTING,
        DOWNLOAD_STATE.MERGING,
        DOWNLOAD_STATE.VERIFYING
      ];
      list = list.filter(d => activeStates.includes(d.state));
    } else if (activeFilter === 'error' || activeFilter === 'failed') {
      list = list.filter(d => d.state === DOWNLOAD_STATE.ERROR || d.state === DOWNLOAD_STATE.CANCELLED);
    } else {
      list = list.filter(d => d.state === activeFilter);
    }
  }

  // 2. Category Filter (Dynamic Extension Inference)
  if (activeCat !== 'all') {
    list = list.filter(d => {
      const cat = (d.category && d.category !== FILE_CATEGORY.OTHER)
        ? d.category
        : detectCategory(d.filename || '');
      return cat === activeCat;
    });
  }

  // 3. Multi-Token Tokenized Search Algorithm
  if (searchQuery) {
    const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(d => {
      const name = (d.filename || '').toLowerCase();
      const url  = (d.url || '').toLowerCase();
      const ext  = (getExtension(d.filename || '')).toLowerCase();
      const cat  = (d.category || detectCategory(d.filename || '')).toLowerCase();
      const target = `${name} ${url} ${ext} ${cat}`;
      return tokens.every(t => target.includes(t));
    });
  }

  // 4. Industry-Grade Multi-Key Stable Sorting
  list.sort((a, b) => {
    let result = 0;
    if (sortCol === 'filename') {
      result = (a.filename || '').localeCompare(b.filename || '', undefined, { numeric: true, sensitivity: 'base' });
    } else if (sortCol === 'total') {
      const szA = a.total > 0 ? a.total : (a.received || 0);
      const szB = b.total > 0 ? b.total : (b.received || 0);
      result = szA - szB;
    } else if (sortCol === 'speed') {
      const spA = a.state === DOWNLOAD_STATE.DOWNLOADING ? (a.speed || 0) : -1;
      const spB = b.state === DOWNLOAD_STATE.DOWNLOADING ? (b.speed || 0) : -1;
      result = spA - spB;
    } else if (sortCol === 'percent') {
      result = (a.percent || 0) - (b.percent || 0);
    } else if (sortCol === 'state') {
      result = (a.state || '').localeCompare(b.state || '');
    } else {
      result = (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    }

    if (result === 0) {
      // Deterministic tie-breaker: newest first
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    }
    return sortDir === 'asc' ? result : -result;
  });

  return list;
}

function renderDownloadsTable() {
  const list   = getFilteredDownloads();
  const tbody  = document.getElementById('dl-tbody');
  const empty  = document.getElementById('table-empty');

  if (!tbody) return;
  tbody.innerHTML = '';

  if (list.length === 0) {
    if (empty) {
      empty.hidden = false;
      const totalAll = Object.keys(downloads).length;
      const titleEl = empty.querySelector('.empty-title');
      const subEl   = empty.querySelector('.empty-sub');
      if (titleEl && subEl) {
        if (totalAll === 0) {
          titleEl.textContent = 'No downloads yet';
          subEl.textContent = 'Start downloading files or click "+ Add Download" above';
        } else {
          titleEl.textContent = 'No downloads match your filters';
          subEl.textContent = 'Try adjusting your search query, status tab, or file category';
        }
      }
    }
    updateSelectAllCheckbox(list);
    updateBulkBar();
    return;
  }

  if (empty) empty.hidden = true;

  // Prune any deleted items from selected set
  for (const id of selected) {
    if (!downloads[id]) selected.delete(id);
  }

  const frag = document.createDocumentFragment();
  let i = 0;
  for (const dl of list) {
    frag.appendChild(buildRow(dl, i++));
  }
  tbody.appendChild(frag);

  updateSelectAllCheckbox(list);
  updateBulkBar();
  updateSidebarStats();
  updateBadges();
}

function buildRow(dl, index = 0) {
  const tr  = document.createElement('tr');
  tr.dataset.id = dl.id;
  tr.style.setProperty('--stagger', Math.min(index, 20));

  const ext = getExtension(dl.filename);
  const badgeMarkup = ext
    ? ext.slice(0, 4).toUpperCase()
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  const pct = dl.percent || 0;

  tr.innerHTML = `
    <td class="col-check">
      <input type="checkbox" class="row-check" data-id="${dl.id}" ${selected.has(dl.id) ? 'checked' : ''} />
    </td>
    <td class="col-file">
      <div class="file-cell">
        <div class="file-ext-badge">${badgeMarkup}</div>
        <div>
          <span class="file-name" title="${escHtml(dl.filename)}">${escHtml(truncateName(dl.filename, 36))}</span>
          <span class="file-url" title="${escHtml(dl.url)}">${escHtml(dl.url)}</span>
        </div>
      </div>
    </td>
    <td class="col-size">${dl.total > 0 ? formatBytes(dl.total) : dl.received > 0 ? `~${formatBytes(dl.received)}` : '—'}</td>
    <td class="col-progress">
      <div class="tbl-progress-wrap">
        <div class="tbl-progress-track">
          <div class="tbl-progress-fill" style="width:${pct}%"></div>
        </div>
        <span class="tbl-progress-label">${pct}%</span>
      </div>
    </td>
    <td class="col-speed">
      <span class="speed-cell">${dl.state === DOWNLOAD_STATE.DOWNLOADING ? formatSpeed(dl.speed) : '—'}</span>
    </td>
    <td class="col-eta">${dl.state === DOWNLOAD_STATE.DOWNLOADING && dl.eta ? formatETA(dl.eta) : '—'}</td>
    <td class="col-status" data-state="${dl.state}">${buildStateBadge(dl.state)}</td>
    <td class="col-actions">
      <div class="row-actions">${buildRowActions(dl)}</div>
    </td>
  `;

  return tr;
}

function buildStateBadge(state) {
  const labels = {
    [DOWNLOAD_STATE.DOWNLOADING]: 'Active',
    [DOWNLOAD_STATE.QUEUED]:      'Queued',
    [DOWNLOAD_STATE.CONNECTING]:  'Connecting',
    [DOWNLOAD_STATE.PAUSED]:      'Paused',
    [DOWNLOAD_STATE.COMPLETED]:   'Done',
    [DOWNLOAD_STATE.ERROR]:       'Failed',
    [DOWNLOAD_STATE.CANCELLED]:   'Cancelled',
    [DOWNLOAD_STATE.MERGING]:     'Merging',
    [DOWNLOAD_STATE.VERIFYING]:   'Verifying',
  };
  return `<span class="status-badge ${state}"><span class="status-dot"></span>${labels[state] || state}</span>`;
}

function buildRowActions(dl) {
  const isActive = [
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING
  ].includes(dl.state);
  const isPaused = dl.state === DOWNLOAD_STATE.PAUSED;
  const isError  = dl.state === DOWNLOAD_STATE.ERROR || dl.state === DOWNLOAD_STATE.CANCELLED;
  const isDone   = dl.state === DOWNLOAD_STATE.COMPLETED;

  let html = '';
  if (isActive) {
    html += `<button class="row-btn row-btn-pause" data-act="pause" data-id="${dl.id}" title="Pause">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
    </button>`;
  }
  if (isPaused) {
    html += `<button class="row-btn row-btn-resume" data-act="resume" data-id="${dl.id}" title="Resume">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
    </button>`;
  }
  if (isError) {
    html += `<button class="row-btn row-btn-retry" data-act="retry" data-id="${dl.id}" title="Retry">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/></svg>
    </button>`;
  }
  if (!isDone) {
    html += `<button class="row-btn row-btn-cancel danger" data-act="cancel" data-id="${dl.id}" title="Cancel">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
  }
  html += `<button class="row-btn row-btn-delete danger" data-act="delete" data-id="${dl.id}" title="Delete">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
  </button>`;
  return html;
}

function updateTableRowState(id) {
  const tbody = document.getElementById('dl-tbody');
  const tr = tbody?.querySelector(`tr[data-id="${id}"]`);
  const dl = downloads[id];
  if (!dl) return;

  if (tr) {
    const statusCol = tr.querySelector('.col-status');
    if (statusCol) {
      statusCol.dataset.state = dl.state;
      statusCol.innerHTML = buildStateBadge(dl.state);
    }
    const actionsWrap = tr.querySelector('.row-actions');
    if (actionsWrap) {
      actionsWrap.innerHTML = buildRowActions(dl);
    }
    const speed = tr.querySelector('.speed-cell');
    if (speed) speed.textContent = dl.state === DOWNLOAD_STATE.DOWNLOADING ? formatSpeed(dl.speed) : '—';
    const eta = tr.querySelector('.col-eta');
    if (eta) eta.textContent = (dl.state === DOWNLOAD_STATE.DOWNLOADING && dl.eta) ? formatETA(dl.eta) : '—';

    // If activeFilter is active and state no longer satisfies it, refresh table
    if (activeFilter !== 'all' && currentView === 'downloads') {
      renderDownloadsTable();
    }
  } else if (currentView === 'downloads') {
    renderDownloadsTable();
  }
}

function updateSelectAllCheckbox(visibleList = getFilteredDownloads()) {
  const selectAll = document.getElementById('select-all');
  if (!selectAll) return;
  if (visibleList.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const visibleSelectedCount = visibleList.filter(d => selected.has(d.id)).length;
  if (visibleSelectedCount === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  } else if (visibleSelectedCount === visibleList.length) {
    selectAll.checked = true;
    selectAll.indeterminate = false;
  } else {
    selectAll.checked = false;
    selectAll.indeterminate = true;
  }
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const countEl = document.getElementById('bulk-count');
  if (!bar) return;

  const count = selected.size;
  if (count > 0) {
    bar.hidden = false;
    if (countEl) countEl.textContent = `${count} selected`;
  } else {
    bar.hidden = true;
  }
}

function bindTableDelegation() {
  const tbody = document.getElementById('dl-tbody');
  if (!tbody || tbody.dataset.delegated) return;
  tbody.dataset.delegated = 'true';

  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.row-btn');
    if (!btn) return;
    const actType = btn.dataset.act;
    const id = btn.dataset.id;
    if (!id) return;

    if (actType === 'pause')  await act(MSG.PAUSE_DOWNLOAD,  id);
    if (actType === 'resume') await act(MSG.RESUME_DOWNLOAD, id);
    if (actType === 'retry')  await act(MSG.RETRY_DOWNLOAD,  id);
    if (actType === 'cancel') await act(MSG.CANCEL_DOWNLOAD, id);
    if (actType === 'delete') await act(MSG.DELETE_DOWNLOAD, id);
  });

  tbody.addEventListener('change', (e) => {
    const cb = e.target.closest('.row-check');
    if (!cb) return;
    const id = cb.dataset.id;
    if (cb.checked) selected.add(id);
    else selected.delete(id);
    updateSelectAllCheckbox();
    updateBulkBar();
  });
}

// ─────────────────────────────────────────────────────────────
//  History View & Ledger Architecture
// ─────────────────────────────────────────────────────────────
function renderHistory() {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  // 1. Gather all terminated ledger items (completed, cancelled, or failed)
  let list = Object.values(downloads).filter(d =>
    [DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.ERROR].includes(d.state)
  );

  // Sync Clear History button disabled state
  const clearBtn = document.getElementById('btn-clear-history');
  if (clearBtn) {
    const hasHistory = list.length > 0;
    clearBtn.disabled = !hasHistory;
    clearBtn.classList.toggle('is-disabled', !hasHistory);
  }

  // 2. Multi-token Search Algorithm (Fuzzy match filename, URL, category, extension)
  if (searchQuery) {
    const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(dl => {
      const text = `${dl.filename || ''} ${dl.url || ''} ${dl.category || detectCategory(dl.filename) || ''} ${getExtension(dl.filename) || ''}`.toLowerCase();
      return tokens.every(token => text.includes(token));
    });
  }

  // 3. Multi-key Natural Sorting Algorithm
  list.sort((a, b) => {
    let cmp = 0;
    if (histSortCol === 'file') {
      cmp = (a.filename || '').localeCompare(b.filename || '', undefined, { numeric: true, sensitivity: 'base' });
    } else if (histSortCol === 'size') {
      cmp = (a.total || a.received || 0) - (b.total || b.received || 0);
    } else if (histSortCol === 'category') {
      const catA = (a.category || detectCategory(a.filename) || '').toLowerCase();
      const catB = (b.category || detectCategory(b.filename) || '').toLowerCase();
      cmp = catA.localeCompare(catB);
    } else { // 'time'
      const timeA = a.completedAt || a.createdAt || 0;
      const timeB = b.completedAt || b.createdAt || 0;
      cmp = timeA - timeB;
    }

    if (cmp !== 0) return histSortDir === 'asc' ? cmp : -cmp;
    // Stable tie-breaker: createdAt descending
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  // 4. Empty State Handling
  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="border:none !important; padding:0 !important; background:transparent !important;">
          <div class="history-empty-state">
            <div class="hist-empty-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 14 14"></polyline>
              </svg>
            </div>
            <p class="hist-empty-title">${searchQuery ? 'No matching downloads found' : 'History is empty'}</p>
            <span class="hist-empty-sub">${searchQuery ? `No archived downloads match "${escHtml(searchQuery)}".` : 'Completed and archived downloads will be permanently cataloged here.'}</span>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  // 5. High-Performance Batched DOM Insertion
  const frag = document.createDocumentFragment();
  list.forEach((dl, idx) => {
    const ext = getExtension(dl.filename);
    const badgeMarkup = ext
      ? ext.slice(0, 4).toUpperCase()
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    const statusTag = dl.state === DOWNLOAD_STATE.COMPLETED
      ? `<span class="hist-status-tag completed">Done</span>`
      : dl.state === DOWNLOAD_STATE.CANCELLED
        ? `<span class="hist-status-tag cancelled">Cancelled</span>`
        : `<span class="hist-status-tag error">Failed</span>`;

    const tr = document.createElement('tr');
    tr.dataset.id = dl.id;
    tr.style.setProperty('--stagger', Math.min(idx, 20));

    tr.innerHTML = `
      <td class="col-hist-file">
        <div class="file-cell">
          <div class="file-ext-badge">${badgeMarkup}</div>
          <div>
            <span class="file-name" title="${escHtml(dl.filename)}">${escHtml(truncateName(dl.filename, 42))}</span>
            <span class="file-url" title="${escHtml(dl.url)}">${escHtml(dl.url)}</span>
          </div>
        </div>
      </td>
      <td class="col-hist-size">${dl.total > 0 ? formatBytes(dl.total) : dl.received > 0 ? `~${formatBytes(dl.received)}` : '—'}</td>
      <td class="col-hist-cat">
        <span class="chip">${escHtml((dl.category || detectCategory(dl.filename)).toUpperCase())}</span>
      </td>
      <td class="col-hist-time">
        <span>${relativeTime(dl.completedAt || dl.createdAt)}</span>
        ${statusTag}
      </td>
      <td class="col-hist-actions">
        <div class="row-actions">
          <button class="row-btn row-btn-retry" data-hist-act="retry" data-id="${dl.id}" title="Download again">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/></svg>
          </button>
          <button class="row-btn row-btn-delete danger" data-hist-act="delete" data-id="${dl.id}" title="Remove from history">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </td>
    `;

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
}

function bindHistory() {
  // Sortable header handlers
  document.querySelectorAll('th.sortable-hist').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (histSortCol === col) {
        histSortDir = histSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        histSortCol = col;
        histSortDir = (col === 'file' || col === 'category') ? 'asc' : 'desc';
      }
      document.querySelectorAll('th.sortable-hist').forEach(t => {
        t.classList.remove('active-sort');
        const arrow = t.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = '↕';
      });
      th.classList.add('active-sort');
      const curArrow = th.querySelector('.sort-arrow');
      if (curArrow) curArrow.textContent = histSortDir === 'asc' ? '↑' : '↓';
      renderHistory();
    });
  });

  // Event delegation on #history-tbody
  const tbody = document.getElementById('history-tbody');
  if (tbody) {
    tbody.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-hist-act]');
      if (!btn) return;
      const act = btn.dataset.histAct;
      const id  = btn.dataset.id;
      if (!id) return;

      if (act === 'delete') {
        await sendMsg({ type: MSG.DELETE_DOWNLOAD, id });
        delete downloads[id];
        renderHistory();
        updateSidebarStats();
        updateBadges();
      } else if (act === 'retry') {
        await sendMsg({ type: MSG.RETRY_DOWNLOAD, id });
        if (downloads[id]) {
          downloads[id].state = DOWNLOAD_STATE.QUEUED;
          downloads[id].percent = 0;
          downloads[id].received = 0;
          downloads[id].speed = 0;
          downloads[id].error = null;
        }
        renderHistory();
        updateSidebarStats();
        updateBadges();
      }
    });
  }

  // Clear history button with confirmation
  document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
    const completed = Object.values(downloads).filter(d =>
      [DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.ERROR].includes(d.state)
    );
    if (completed.length === 0) return;

    if (!confirm(`Are you sure you want to clear all ${completed.length} items from history?`)) return;

    await sendMsg({ type: MSG.CLEAR_HISTORY });
    for (const dl of completed) {
      delete downloads[dl.id];
    }
    renderHistory();
    updateSidebarStats();
    updateBadges();
  });
}

// ─────────────────────────────────────────────────────────────
//  Queue View & Scheduler Pipeline
// ─────────────────────────────────────────────────────────────
function renderQueue() {
  const list = document.getElementById('queue-list');
  if (!list) return;

  // Synchronize concurrency limit slider & value badge with active settings
  const qSlider = document.getElementById('q-max-concurrent');
  const qVal    = document.getElementById('q-max-val');
  if (qSlider && settings.maxConcurrent) {
    qSlider.value = settings.maxConcurrent;
    updateSliderFill(qSlider, qVal);
  }

  // Industry-grade queue order resolution:
  // 1. Primary order via latestQueueOrder array from QueueManager
  // 2. Stable fallback via createdAt ascending
  const queued = Object.values(downloads)
    .filter(d => d.state === DOWNLOAD_STATE.QUEUED)
    .sort((a, b) => {
      const idxA = latestQueueOrder.indexOf(a.id);
      const idxB = latestQueueOrder.indexOf(b.id);
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
    div.style.setProperty('--stagger', Math.min(idx, 20));

    div.innerHTML = `
      <span class="q-rank">#${idx + 1}</span>
      <div class="file-ext-badge">${badgeMarkup}</div>
      <div class="q-details">
        <span class="q-title" title="${escHtml(dl.filename)}">${escHtml(truncateName(dl.filename, 48))}</span>
        <div class="q-meta">
          <span>${escHtml((dl.category || detectCategory(dl.filename)).toUpperCase())}</span>
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

function bindQueue() {
  const qSlider = document.getElementById('q-max-concurrent');
  const qVal    = document.getElementById('q-max-val');

  if (qSlider) {
    qSlider.value = settings.maxConcurrent || 3;
    updateSliderFill(qSlider, qVal);

    qSlider.addEventListener('input', () => {
      updateSliderFill(qSlider, qVal);
      const val = Number(qSlider.value);
      settings.maxConcurrent = val;

      // Keep settings view slider in sync if rendered
      const setSlider = document.getElementById('setting-max-concurrent');
      const setVal = document.getElementById('val-max-concurrent');
      if (setSlider) {
        setSlider.value = val;
        updateSliderFill(setSlider, setVal);
      }

      clearTimeout(debounceQueueSliderTimer);
      debounceQueueSliderTimer = setTimeout(async () => {
        await sendMsg({ type: MSG.UPDATE_SETTINGS, payload: { maxConcurrent: val } });
      }, 120);
    });
  }

  // Event delegation on #queue-list
  const qList = document.getElementById('queue-list');
  if (qList) {
    qList.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-q-action]');
      if (!btn) return;
      const action = btn.dataset.qAction;
      const id = btn.dataset.id;
      if (!id) return;

      if (action === 'boost') {
        const res = await sendMsg({ type: MSG.PRIORITIZE_DOWNLOAD, id });
        if (res?.queueOrder) latestQueueOrder = res.queueOrder;
        renderQueue();
      } else if (action === 'move-up') {
        const res = await sendMsg({ type: MSG.MOVE_QUEUE_ITEM, id, direction: 'up' });
        if (res?.queueOrder) latestQueueOrder = res.queueOrder;
        renderQueue();
      } else if (action === 'move-down') {
        const res = await sendMsg({ type: MSG.MOVE_QUEUE_ITEM, id, direction: 'down' });
        if (res?.queueOrder) latestQueueOrder = res.queueOrder;
        renderQueue();
      } else if (action === 'start') {
        await sendMsg({ type: MSG.START_QUEUED_NOW, id });
        if (downloads[id]) downloads[id].state = DOWNLOAD_STATE.DOWNLOADING;
        renderQueue();
        updateBadges();
      } else if (action === 'cancel') {
        await sendMsg({ type: MSG.CANCEL_DOWNLOAD, id });
        if (downloads[id]) downloads[id].state = DOWNLOAD_STATE.CANCELLED;
        renderQueue();
        updateBadges();
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  Statistics
// ─────────────────────────────────────────────────────────────
async function renderStats() {
  const res = await sendMsg({ type: MSG.GET_DOWNLOADS });
  const all = res?.downloads || [];

  const completedDownloads = all.filter(d => d.state === DOWNLOAD_STATE.COMPLETED);
  const totalFiles         = completedDownloads.length;
  const totalSize          = completedDownloads.reduce((s, d) => s + (d.total || d.received || 0), 0);

  // Accurately compute positive elapsed download durations
  const completedTimeMs = completedDownloads.reduce((sum, d) => {
    if (d.completedAt && d.startedAt && d.completedAt > d.startedAt) {
      return sum + (d.completedAt - d.startedAt);
    }
    return sum;
  }, 0);

  const activeDownloads = all.filter(d => d.state === DOWNLOAD_STATE.DOWNLOADING);
  const activeTimeMs = activeDownloads.reduce((sum, d) => {
    if (d.startedAt && Date.now() > d.startedAt) {
      return sum + (Date.now() - d.startedAt);
    }
    return sum;
  }, 0);

  const totalTimeMs = Math.max(0, completedTimeMs + activeTimeMs);

  // Real-time weighted average download speed
  let avgSpeedBps = 0;
  if (activeDownloads.length > 0) {
    avgSpeedBps = activeDownloads.reduce((s, d) => s + (d.speed || 0), 0) / activeDownloads.length;
  } else if (totalTimeMs > 0 && totalSize > 0) {
    avgSpeedBps = totalSize / (totalTimeMs / 1000);
  }

  // Modern Geist SVG icons replacing OS emojis
  const statIcons = [
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
  ];

  document.querySelectorAll('.stat-card').forEach((card, idx) => {
    card.style.setProperty('--stagger', idx);
    const iconEl = card.querySelector('.stat-icon');
    if (iconEl && statIcons[idx]) iconEl.innerHTML = statIcons[idx];
  });

  document.getElementById('stat-total-files').textContent = totalFiles.toLocaleString();
  document.getElementById('stat-total-size').textContent  = formatBytes(totalSize);
  document.getElementById('stat-avg-speed').textContent   = formatSpeed(avgSpeedBps);

  const totalMin = Math.floor(totalTimeMs / 60000);
  const totalSec = Math.floor((totalTimeMs % 60000) / 1000);
  document.getElementById('stat-total-time').textContent = totalMin > 60
    ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
    : totalMin > 0 ? `${totalMin}m ${totalSec}s` : `${totalSec}s`;

  drawCategoryChart(all);
}

function drawCategoryChart(allDownloads) {
  const canvas       = document.getElementById('chart-category');
  const distBar      = document.getElementById('cat-distribution-bar');
  const pillsWrap    = document.getElementById('cat-pills-wrap');
  const canvasWrap   = document.getElementById('chart-canvas-wrap');
  const emptyState   = document.getElementById('chart-empty-state');
  const totalBadge   = document.getElementById('chart-total-badge');

  if (!canvas) return;

  // Aggregate category counts and volume sizes
  const catStats = {};
  let totalCategorizedCount = 0;
  let totalCategorizedBytes = 0;

  for (const dl of allDownloads) {
    const cat = (dl.category || detectCategory(dl.filename) || 'other').toLowerCase();
    if (!catStats[cat]) {
      catStats[cat] = { count: 0, bytes: 0 };
    }
    const bytes = dl.total || dl.received || 0;
    catStats[cat].count += 1;
    catStats[cat].bytes += bytes;
    totalCategorizedCount += 1;
    totalCategorizedBytes += bytes;
  }

  const sortedCats = Object.entries(catStats).sort((a, b) => b[1].count - a[1].count || b[1].bytes - a[1].bytes);

  if (sortedCats.length === 0) {
    if (distBar)    distBar.hidden = true;
    if (pillsWrap)  pillsWrap.hidden = true;
    if (canvasWrap) canvasWrap.hidden = true;
    if (emptyState) emptyState.hidden = false;
    if (totalBadge) totalBadge.textContent = '0 categories';
    return;
  }

  // Active state: show distribution bar, pills, and chart
  if (emptyState) emptyState.hidden = true;
  if (distBar)    distBar.hidden = false;
  if (pillsWrap)  pillsWrap.hidden = false;
  if (canvasWrap) canvasWrap.hidden = false;
  if (totalBadge) totalBadge.textContent = `${sortedCats.length} ${sortedCats.length === 1 ? 'category' : 'categories'}`;

  const shades = [1, 0.82, 0.65, 0.48, 0.35, 0.22];

  // 1. Proportional Distribution Bar
  if (distBar) {
    distBar.innerHTML = '';
    sortedCats.forEach(([cat, data], idx) => {
      const pct = Math.max(2, ((data.count / totalCategorizedCount) * 100));
      const seg = document.createElement('div');
      seg.className = 'cat-dist-segment';
      seg.style.width = `${pct}%`;
      seg.style.background = `rgba(33, 37, 41, ${shades[idx % shades.length]})`;
      seg.title = `${cat.toUpperCase()}: ${data.count} ${data.count === 1 ? 'file' : 'files'} (${pct.toFixed(1)}%) • ${formatBytes(data.bytes)}`;
      distBar.appendChild(seg);
    });
  }

  // 2. Category Summary Metric Pills
  if (pillsWrap) {
    pillsWrap.innerHTML = '';
    sortedCats.forEach(([cat, data], idx) => {
      const pct = ((data.count / totalCategorizedCount) * 100).toFixed(0);
      const pill = document.createElement('div');
      pill.className = 'cat-metric-pill';
      pill.innerHTML = `
        <span class="cat-pill-dot" style="opacity: ${shades[idx % shades.length]}"></span>
        <span class="cat-pill-name">${escHtml(cat)}</span>
        <span class="cat-pill-stats">${data.count} ${data.count === 1 ? 'file' : 'files'} • ${formatBytes(data.bytes)} (${pct}%)</span>
      `;
      pillsWrap.appendChild(pill);
    });
  }

  // 3. Precision Retina Canvas Bar Chart
  const ctx = canvas.getContext('2d');
  const parentWidth = canvasWrap ? canvasWrap.clientWidth : 600;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(340, parentWidth);
  const H = 220;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const chartBottom = H - 38;
  const chartTop = 32;
  const chartHeight = chartBottom - chartTop;
  const maxVal = Math.max(...sortedCats.map(c => c[1].count), 1);

  // Gridlines & Axis Markers
  ctx.strokeStyle = 'rgba(173, 181, 189, 0.18)';
  ctx.lineWidth = 1;

  // 50% line
  ctx.beginPath();
  ctx.moveTo(35, chartTop + chartHeight / 2);
  ctx.lineTo(W - 20, chartTop + chartHeight / 2);
  ctx.stroke();

  // Baseline
  ctx.strokeStyle = 'rgba(173, 181, 189, 0.3)';
  ctx.beginPath();
  ctx.moveTo(35, chartBottom);
  ctx.lineTo(W - 20, chartBottom);
  ctx.stroke();

  // Y-axis value labels
  ctx.fillStyle = '#adb5bd';
  ctx.font = '600 9.5px Geist Mono, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(maxVal.toString(), 28, chartTop + 4);
  ctx.fillText(Math.round(maxVal / 2).toString(), 28, chartTop + chartHeight / 2 + 3);
  ctx.fillText('0', 28, chartBottom + 3);

  const count = sortedCats.length;
  const availableWidth = W - 70;
  const slotWidth = availableWidth / count;
  const barWidth = Math.min(54, Math.max(26, slotWidth * 0.52));

  sortedCats.forEach(([cat, data], i) => {
    const centerX = 45 + i * slotWidth + slotWidth / 2;
    const barX = centerX - barWidth / 2;
    const barH = Math.max(5, Math.round((data.count / maxVal) * chartHeight));
    const barY = chartBottom - barH;

    // Solid Ink Bar with Rounded Top
    ctx.fillStyle = `rgba(33, 37, 41, ${shades[i % shades.length]})`;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barH, [4, 4, 0, 0]);
    ctx.fill();

    // Value on top of bar
    ctx.fillStyle = '#212529';
    ctx.font = '700 11px Geist Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(data.count.toString(), centerX, barY - 14);

    // Sub-metric bytes below count
    ctx.fillStyle = '#adb5bd';
    ctx.font = '500 9px Geist Mono, monospace';
    ctx.fillText(formatBytes(data.bytes), centerX, barY - 4);

    // Category label below baseline
    ctx.fillStyle = '#212529';
    ctx.font = '700 10px Geist Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(cat.toUpperCase(), centerX, chartBottom + 18);
  });
}

// ─────────────────────────────────────────────────────────────
//  Settings UI
// ─────────────────────────────────────────────────────────────
function updateSliderFill(slider, valSpan) {
  if (!slider) return;
  const min = Number(slider.min) || 1;
  const max = Number(slider.max) || 100;
  const val = Number(slider.value);
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  slider.style.background = `linear-gradient(to right, var(--geist-ink) 0%, var(--geist-ink) ${pct}%, var(--bg-track) ${pct}%, var(--bg-track) 100%)`;
  if (valSpan) valSpan.textContent = val;
}

function loadSettingsUI() {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val;
    else el.value = val ?? '';
  };

  setVal('setting-intercept',        s.interceptDownloads);
  setVal('setting-autostart',        s.autoStart);
  setVal('setting-max-concurrent',   s.maxConcurrent);
  setVal('setting-max-chunks',       s.maxChunks);
  setVal('setting-speed-limit',      s.speedLimitKBps);
  setVal('setting-verify-integrity', s.verifyIntegrity);
  setVal('setting-notifications',    s.showNotifications);
  setVal('setting-max-history',      s.maxHistoryItems);

  const sMaxConcurrent = document.getElementById('setting-max-concurrent');
  const vMaxConcurrent = document.getElementById('val-max-concurrent');
  updateSliderFill(sMaxConcurrent, vMaxConcurrent);

  const sMaxChunks = document.getElementById('setting-max-chunks');
  const vMaxChunks = document.getElementById('val-max-chunks');
  updateSliderFill(sMaxChunks, vMaxChunks);

  document.querySelectorAll('.settings-group').forEach((grp, idx) => {
    grp.style.setProperty('--stagger', idx);
  });
}

function bindSettings() {
  const sMaxConcurrent = document.getElementById('setting-max-concurrent');
  const vMaxConcurrent = document.getElementById('val-max-concurrent');
  sMaxConcurrent?.addEventListener('input', () => {
    updateSliderFill(sMaxConcurrent, vMaxConcurrent);
    const qSlider = document.getElementById('q-max-concurrent');
    const qVal    = document.getElementById('q-max-val');
    if (qSlider) {
      qSlider.value = sMaxConcurrent.value;
      updateSliderFill(qSlider, qVal);
    }
  });

  const sMaxChunks = document.getElementById('setting-max-chunks');
  const vMaxChunks = document.getElementById('val-max-chunks');
  sMaxChunks?.addEventListener('input', () => updateSliderFill(sMaxChunks, vMaxChunks));

  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const get = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      if (el.type === 'checkbox') return el.checked;
      if (el.type === 'number' || el.type === 'range') return Number(el.value);
      return el.value;
    };

    const newSettings = {
      interceptDownloads: get('setting-intercept'),
      autoStart:          get('setting-autostart'),
      maxConcurrent:      get('setting-max-concurrent'),
      maxChunks:          get('setting-max-chunks'),
      speedLimitKBps:     get('setting-speed-limit'),
      verifyIntegrity:    get('setting-verify-integrity'),
      showNotifications:  get('setting-notifications'),
      maxHistoryItems:    get('setting-max-history'),
    };

    const res = await sendMsg({ type: MSG.UPDATE_SETTINGS, payload: newSettings });
    if (res?.settings) settings = res.settings;

    const $status = document.getElementById('save-status');
    if ($status) {
      $status.textContent = 'Settings Saved';
      $status.classList.add('visible');
      setTimeout(() => $status.classList.remove('visible'), 2500);
    }
  });

  document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
    if (!confirm('This will clear ALL download history and reset stats. Are you sure?')) return;
    await sendMsg({ type: MSG.CLEAR_HISTORY });
    downloads = {};
    renderView(currentView);
  });
}

// ─────────────────────────────────────────────────────────────
//  Filter Tabs & Category Chips
// ─────────────────────────────────────────────────────────────
function bindFilters() {
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderDownloadsTable();
    });
  });

  document.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCat = btn.dataset.cat;
      renderDownloadsTable();
    });
  });

  // Sortable headers
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = (col === 'filename' || col === 'state') ? 'asc' : 'desc';
      }
      document.querySelectorAll('th.sortable').forEach(t => {
        t.classList.remove('active-sort');
        const arrow = t.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = '↕';
      });
      th.classList.add('active-sort');
      const curArrow = th.querySelector('.sort-arrow');
      if (curArrow) curArrow.textContent = sortDir === 'asc' ? '↑' : '↓';
      renderDownloadsTable();
    });
  });

  // Select all (tri-state aware)
  document.getElementById('select-all')?.addEventListener('change', (e) => {
    const visible = getFilteredDownloads();
    const shouldSelect = e.target.checked;
    for (const dl of visible) {
      if (shouldSelect) selected.add(dl.id);
      else selected.delete(dl.id);
    }
    document.querySelectorAll('#dl-tbody .row-check').forEach(cb => {
      cb.checked = shouldSelect;
    });
    updateSelectAllCheckbox(visible);
    updateBulkBar();
  });
}

// ─────────────────────────────────────────────────────────────
//  Topbar bindings
// ─────────────────────────────────────────────────────────────
function bindTopbar() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (currentView === 'history') renderHistory();
        else renderDownloadsTable();
      }, 50);
    });
  }

  document.getElementById('btn-add-download')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-add');
    if (modal) {
      modal.hidden = false;
      setTimeout(() => document.getElementById('dash-url-input')?.focus(), 50);
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  Modal
// ─────────────────────────────────────────────────────────────
function bindModal() {
  const $modal = document.getElementById('modal-add');
  if (!$modal) return;

  document.getElementById('modal-close')?.addEventListener('click', () => { $modal.hidden = true; });
  document.getElementById('dash-modal-cancel')?.addEventListener('click', () => { $modal.hidden = true; });
  $modal.addEventListener('click', (e) => { if (e.target === $modal) $modal.hidden = true; });

  document.getElementById('dash-btn-start')?.addEventListener('click', async () => {
    const urlInput = document.getElementById('dash-url-input');
    const url      = urlInput?.value.trim() || '';
    const filename = document.getElementById('dash-filename-input')?.value.trim() || undefined;
    const sched    = document.getElementById('dash-schedule-input')?.value;

    if (!isValidUrl(url)) {
      if (urlInput) {
        urlInput.style.background = 'rgba(255, 0, 0, 0.08)';
        urlInput.focus();
        setTimeout(() => { urlInput.style.background = ''; }, 1500);
      }
      return;
    }

    const scheduledAt = sched ? new Date(sched).getTime() : null;
    await sendMsg({ type: MSG.START_DOWNLOAD, payload: { url, filename, scheduledAt } });

    $modal.hidden = true;
    if (urlInput) urlInput.value = '';
    const fnInput = document.getElementById('dash-filename-input');
    if (fnInput) fnInput.value = '';
    const scInput = document.getElementById('dash-schedule-input');
    if (scInput) scInput.value = '';
  });
}

// ─────────────────────────────────────────────────────────────
//  Bulk Actions
// ─────────────────────────────────────────────────────────────
function bindBulkActions() {
  document.getElementById('bulk-pause')?.addEventListener('click',  () => bulkAction(MSG.PAUSE_DOWNLOAD));
  document.getElementById('bulk-resume')?.addEventListener('click', () => bulkAction(MSG.RESUME_DOWNLOAD));
  document.getElementById('bulk-cancel')?.addEventListener('click', () => bulkAction(MSG.CANCEL_DOWNLOAD));
  document.getElementById('bulk-delete')?.addEventListener('click', () => bulkAction(MSG.DELETE_DOWNLOAD));
  document.getElementById('bulk-clear-sel')?.addEventListener('click', () => {
    selected.clear();
    document.querySelectorAll('.row-check').forEach(c => c.checked = false);
    updateSelectAllCheckbox();
    updateBulkBar();
  });
}

async function bulkAction(msgType) {
  if (selected.size === 0) return;
  const ids = [...selected];
  for (const id of ids) {
    await sendMsg({ type: msgType, id });
    if (msgType === MSG.DELETE_DOWNLOAD) delete downloads[id];
  }
  if (msgType === MSG.DELETE_DOWNLOAD || msgType === MSG.CANCEL_DOWNLOAD) {
    selected.clear();
  }
  updateSelectAllCheckbox();
  updateBulkBar();
  updateSidebarStats();
  updateBadges();
  renderDownloadsTable();
}

// ─────────────────────────────────────────────────────────────
//  Sidebar / Badge updates
// ─────────────────────────────────────────────────────────────
function updateSidebarStats() {
  const all    = Object.values(downloads);
  const active = all.filter(d => d.state === DOWNLOAD_STATE.DOWNLOADING);
  const speed  = active.reduce((s, d) => s + (d.speed || 0), 0);

  const $speed = document.getElementById('sidebar-total-speed');
  const $count = document.getElementById('sidebar-active-count');
  const $dot   = document.getElementById('sidebar-active-dot');

  if ($speed) $speed.textContent = formatSpeed(speed);
  if ($count) $count.textContent = active.length;
  if ($dot)   $dot.classList.toggle('is-active', active.length > 0);
}

function updateBadges() {
  const all    = Object.values(downloads);
  const active = all.filter(d => [DOWNLOAD_STATE.DOWNLOADING, DOWNLOAD_STATE.QUEUED, DOWNLOAD_STATE.CONNECTING].includes(d.state));
  const queue  = all.filter(d => d.state === DOWNLOAD_STATE.QUEUED);

  const $badge = document.getElementById('nav-badge-downloads');
  $badge.textContent = active.length;
  $badge.hidden = active.length === 0;

  const $qBadge = document.getElementById('nav-badge-queue');
  $qBadge.textContent = queue.length;
  $qBadge.hidden = queue.length === 0;
}

// ─────────────────────────────────────────────────────────────
//  Action helper
// ─────────────────────────────────────────────────────────────
async function act(type, id) {
  await sendMsg({ type, id });
  if (type === MSG.DELETE_DOWNLOAD) {
    delete downloads[id];
    selected.delete(id);
    updateSelectAllCheckbox();
    updateBulkBar();
    updateSidebarStats();
    updateBadges();
    renderDownloadsTable();
  } else if (type === MSG.CANCEL_DOWNLOAD) {
    if (downloads[id]) downloads[id].state = DOWNLOAD_STATE.CANCELLED;
    selected.delete(id);
    updateTableRowState(id);
    updateSelectAllCheckbox();
    updateBulkBar();
    updateSidebarStats();
    updateBadges();
  } else if (type === MSG.PAUSE_DOWNLOAD) {
    if (downloads[id]) downloads[id].state = DOWNLOAD_STATE.PAUSED;
    updateTableRowState(id);
    updateSidebarStats();
    updateBadges();
  } else if (type === MSG.RESUME_DOWNLOAD) {
    if (downloads[id]) downloads[id].state = DOWNLOAD_STATE.DOWNLOADING;
    updateTableRowState(id);
    updateSidebarStats();
    updateBadges();
  }
}

// ─────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────
function sendMsg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────
//  Window Resize & Boot
// ─────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (currentView === 'stats') renderStats();
});

init().catch(console.error);
