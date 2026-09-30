// ============================================================
//  All-Downloader — Downloads Table View & RAF Updates
// ============================================================
import { DOWNLOAD_STATE, MSG } from '../../../shared/constants.js';
import {
  formatBytes, formatSpeed, formatETA, formatHumanETA,
  truncateName, getExtension
} from '../../../shared/utils.js';
import { state } from '../state.js';
import { sendMsg } from '../api.js';
import { escHtml, renderPaginationControls } from '../dom-helpers.js';
import { getFilteredDownloads } from '../filters.js';
import { updateSelectAllCheckbox, updateBulkBar } from '../bulk-actions.js';
import { updateSidebarStats, updateBadges } from '../sidebar.js';

export function formatETADisplay(dl: any): string {
  if (dl.state !== DOWNLOAD_STATE.DOWNLOADING) {
    return '—';
  }
  if (dl.eta && dl.eta > 0) {
    return formatHumanETA(dl.eta);
  }
  if (dl.speed && dl.speed > 0) {
    return '<span class="eta-calc">Calculating…</span>';
  }
  return '—';
}

export function formatSizeDisplay(dl: any): string {
  const total = dl.total || dl.filesize || 0;
  const received = dl.received || dl.receivedBytes || 0;

  if (dl.state === DOWNLOAD_STATE.COMPLETED && total > 0) {
    return `<div class="size-cell-wrap"><span class="size-downloaded">${formatBytes(total)}</span></div>`;
  }

  if (total > 0) {
    return `<div class="size-cell-wrap"><span class="size-downloaded">${formatBytes(received)}</span><span class="size-sep">/</span><span class="size-total">${formatBytes(total)}</span></div>`;
  }

  if (received > 0) {
    return `<div class="size-cell-wrap"><span class="size-downloaded">~${formatBytes(received)}</span></div>`;
  }

  return '<div class="size-cell-wrap"><span class="size-total">—</span></div>';
}

export function queueProgressUpdate(id: string): void {
  state.pendingProgressIds.add(id);
  if (!state.rafScheduled) {
    state.rafScheduled = true;
    requestAnimationFrame(flushProgressUpdates);
  }
}

export function flushProgressUpdates(): void {
  state.rafScheduled = false;
  if (state.currentView !== 'downloads') {
    state.pendingProgressIds.clear();
    updateSidebarStats();
    return;
  }

  for (const id of state.pendingProgressIds) {
    const dl = state.downloads[id];
    if (!dl) continue;
    const refs = state.rowCache.get(id);
    if (!refs || !refs.tr.isConnected) continue;

    // Mutate in-place using cached element references — zero DOM querying & zero layout thrashing
    if (refs.fill) refs.fill.style.width = `${dl.percent || 0}%`;
    if (refs.label) refs.label.textContent = `${dl.percent || 0}%`;
    if (refs.sizeCell) refs.sizeCell.innerHTML = formatSizeDisplay(dl);
    if (refs.speed) refs.speed.textContent = dl.state === DOWNLOAD_STATE.DOWNLOADING ? formatSpeed(dl.speed) : '—';
    if (refs.eta) refs.eta.innerHTML = formatETADisplay(dl);

    if (refs.statusCol && refs.statusCol.dataset.state !== dl.state) {
      refs.statusCol.dataset.state = dl.state;
      refs.statusCol.innerHTML = buildStateBadge(dl.state);
    }
  }

  state.pendingProgressIds.clear();
  updateSidebarStats();
}

export function buildStateBadge(dlState: string): string {
  const labels: Record<string, string> = {
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
  return `<span class="status-badge ${dlState}"><span class="status-dot"></span>${labels[dlState] || dlState}</span>`;
}

export function buildRowActions(dl: any): string {
  const isActive = [
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING
  ].includes(dl.state);
  const isPaused = dl.state === DOWNLOAD_STATE.PAUSED || dl.state === DOWNLOAD_STATE.QUEUED;
  const isError  = dl.state === DOWNLOAD_STATE.ERROR || dl.state === DOWNLOAD_STATE.CANCELLED;
  const isDone   = dl.state === DOWNLOAD_STATE.COMPLETED;

  let html = '';
  if (isActive) {
    html += `<button class="row-btn row-btn-pause" data-act="pause" data-id="${dl.id}" title="Pause">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
    </button>`;
  }
  if (isPaused) {
    html += `<button class="row-btn row-btn-resume" data-act="resume" data-id="${dl.id}" title="${dl.state === DOWNLOAD_STATE.QUEUED ? 'Start' : 'Resume'}">
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

export function buildRow(dl: any, index = 0): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.dataset.id = dl.id;
  tr.dataset.state = dl.state;
  tr.style.setProperty('--stagger', String(Math.min(index, 20)));

  const ext = getExtension(dl.filename);
  const badgeMarkup = ext
    ? ext.slice(0, 4).toUpperCase()
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  const pct = dl.percent || 0;

  tr.innerHTML = `
    <td class="col-check">
      <input type="checkbox" class="row-check" data-id="${dl.id}" ${state.selected.has(dl.id) ? 'checked' : ''} />
    </td>
    <td class="col-file">
      <div class="file-cell">
        <div class="file-ext-badge">${badgeMarkup}</div>
        <div class="file-meta-wrap">
          <span class="file-name" title="${escHtml(dl.filename)}">${escHtml(truncateName(dl.filename, 36))}</span>
          <span class="file-url" title="${escHtml(dl.url)}">${escHtml(dl.url)}</span>
        </div>
      </div>
    </td>
    <td class="col-size">${formatSizeDisplay(dl)}</td>
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
    <td class="col-eta">${formatETADisplay(dl)}</td>
    <td class="col-status" data-state="${dl.state}">${buildStateBadge(dl.state)}</td>
    <td class="col-actions">
      <div class="row-actions">${buildRowActions(dl)}</div>
    </td>
  `;

  // Retain element references in cache to prevent querySelector layout thrashing during animations
  state.rowCache.set(dl.id, {
    tr,
    fill: tr.querySelector('.tbl-progress-fill'),
    label: tr.querySelector('.tbl-progress-label'),
    sizeCell: tr.querySelector('.col-size'),
    speed: tr.querySelector('.speed-cell'),
    eta: tr.querySelector('.col-eta'),
    statusCol: tr.querySelector('.col-status'),
  });

  return tr;
}

export function updateTableRowState(id: string): void {
  const tbody = document.getElementById('dl-tbody');
  const tr = tbody?.querySelector(`tr[data-id="${id}"]`);
  const dl = state.downloads[id];
  if (!dl) return;

  if (tr) {
    (tr as HTMLElement).dataset.state = dl.state;
    const statusCol = tr.querySelector('.col-status') as HTMLElement | null;
    if (statusCol) {
      statusCol.dataset.state = dl.state;
      statusCol.innerHTML = buildStateBadge(dl.state);
    }
    const sizeCell = tr.querySelector('.col-size') as HTMLElement | null;
    if (sizeCell) {
      sizeCell.innerHTML = formatSizeDisplay(dl);
    }
    const actionsWrap = tr.querySelector('.row-actions');
    if (actionsWrap) {
      actionsWrap.innerHTML = buildRowActions(dl);
    }
    const speed = tr.querySelector('.speed-cell');
    if (speed) speed.textContent = dl.state === DOWNLOAD_STATE.DOWNLOADING ? formatSpeed(dl.speed) : '—';
    const eta = tr.querySelector('.col-eta');
    if (eta) eta.innerHTML = formatETADisplay(dl);

    // If activeFilter is active and state no longer satisfies it, refresh table
    if (state.activeFilter !== 'all' && state.currentView === 'downloads') {
      renderDownloadsTable();
    }
  } else if (state.currentView === 'downloads') {
    renderDownloadsTable();
  }
}

export function renderDownloadsTable(): void {
  const list = getFilteredDownloads();
  const tbody = document.getElementById('dl-tbody');
  const empty = document.getElementById('table-empty');

  if (!tbody) return;
  tbody.innerHTML = '';
  state.rowCache.clear();

  if (list.length === 0) {
    if (empty) {
      empty.hidden = false;
      const totalAll = Object.keys(state.downloads).length;
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
    renderPaginationControls(0, 1, 1, 'dl-pagination', () => {});
    updateSelectAllCheckbox(list);
    updateBulkBar();
    return;
  }

  if (empty) empty.hidden = true;

  // Prune any deleted items from selected set
  for (const id of state.selected) {
    if (!state.downloads[id]) state.selected.delete(id);
  }

  // Bounded pagination: only keep active page DOM nodes in memory
  const totalPages = Math.ceil(list.length / state.PAGE_SIZE) || 1;
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  const startIdx = (state.currentPage - 1) * state.PAGE_SIZE;
  const pageSlice = list.slice(startIdx, startIdx + state.PAGE_SIZE);

  const frag = document.createDocumentFragment();
  let i = 0;
  for (const dl of pageSlice) {
    frag.appendChild(buildRow(dl, i++));
  }
  tbody.appendChild(frag);

  renderPaginationControls(list.length, state.currentPage, totalPages, 'dl-pagination', (newPage) => {
    state.currentPage = newPage;
    renderDownloadsTable();
  });

  updateSelectAllCheckbox(list);
  updateBulkBar();
  updateSidebarStats();
  updateBadges();
}

export async function act(type: string, id: string): Promise<void> {
  await sendMsg({ type, id });
  if (type === MSG.DELETE_DOWNLOAD) {
    delete state.downloads[id];
    state.selected.delete(id);
    updateSelectAllCheckbox();
    updateBulkBar();
    updateSidebarStats();
    updateBadges();
    renderDownloadsTable();
  } else if (type === MSG.CANCEL_DOWNLOAD) {
    if (state.downloads[id]) state.downloads[id].state = DOWNLOAD_STATE.CANCELLED;
    state.selected.delete(id);
    updateTableRowState(id);
    updateSelectAllCheckbox();
    updateBulkBar();
    updateSidebarStats();
    updateBadges();
  } else if (type === MSG.PAUSE_DOWNLOAD) {
    if (state.downloads[id]) state.downloads[id].state = DOWNLOAD_STATE.PAUSED;
    updateTableRowState(id);
    updateSidebarStats();
    updateBadges();
  } else if (type === MSG.RESUME_DOWNLOAD) {
    if (state.downloads[id]) state.downloads[id].state = DOWNLOAD_STATE.DOWNLOADING;
    updateTableRowState(id);
    updateSidebarStats();
    updateBadges();
  }
}

export function bindTableDelegation(): void {
  const tbody = document.getElementById('dl-tbody');
  if (!tbody || (tbody as any).dataset.delegated) return;
  (tbody as any).dataset.delegated = 'true';

  tbody.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.row-btn') as HTMLElement | null;
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
    const cb = (e.target as HTMLElement).closest('.row-check') as HTMLInputElement | null;
    if (!cb) return;
    const id = cb.dataset.id;
    if (!id) return;
    if (cb.checked) state.selected.add(id);
    else state.selected.delete(id);
    updateSelectAllCheckbox();
    updateBulkBar();
  });
}
