// ============================================================
//  All-Downloader — History Ledger View & Operations
// ============================================================
import { DOWNLOAD_STATE, MSG } from '../../../shared/constants.js';
import {
  formatBytes, relativeTime, truncateName,
  getExtension, detectCategory
} from '../../../shared/utils.js';
import { state } from '../state.js';
import { sendMsg } from '../api.js';
import { escHtml, renderPaginationControls } from '../dom-helpers.js';
import { updateSidebarStats, updateBadges } from '../sidebar.js';

export function renderHistory(): void {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  // 1. Gather all terminated ledger items (completed, cancelled, or failed)
  let list = Object.values(state.downloads).filter(d =>
    [DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.ERROR].includes(d.state)
  );

  // Sync Clear History button disabled state
  const clearBtn = document.getElementById('btn-clear-history') as HTMLButtonElement | null;
  if (clearBtn) {
    const hasHistory = list.length > 0;
    clearBtn.disabled = !hasHistory;
    clearBtn.classList.toggle('is-disabled', !hasHistory);
  }

  // 2. Multi-token Search Algorithm (Fuzzy match filename, URL, category, extension)
  if (state.searchQuery) {
    const tokens = state.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(dl => {
      const text = `${dl.filename || ''} ${dl.url || ''} ${dl.category || detectCategory(dl.filename, (dl as any).mimeType) || ''} ${getExtension(dl.filename) || ''}`.toLowerCase();
      return tokens.every(token => text.includes(token));
    });
  }

  // 3. Multi-key Natural Sorting Algorithm
  list.sort((a, b) => {
    let cmp = 0;
    if (state.histSortCol === 'file') {
      cmp = (a.filename || '').localeCompare(b.filename || '', undefined, { numeric: true, sensitivity: 'base' });
    } else if (state.histSortCol === 'size') {
      cmp = (a.total || a.received || 0) - (b.total || b.received || 0);
    } else if (state.histSortCol === 'category') {
      const catA = (a.category || detectCategory(a.filename, (a as any).mimeType) || '').toLowerCase();
      const catB = (b.category || detectCategory(b.filename, (b as any).mimeType) || '').toLowerCase();
      cmp = catA.localeCompare(catB);
    } else { // 'time'
      const timeA = a.completedAt || a.createdAt || 0;
      const timeB = b.completedAt || b.createdAt || 0;
      cmp = timeA - timeB;
    }

    if (cmp !== 0) return state.histSortDir === 'asc' ? cmp : -cmp;
    // Stable tie-breaker: createdAt descending
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  // 4. Empty State Handling
  if (list.length === 0) {
    renderPaginationControls(0, 1, 1, 'history-pagination', () => {});
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
            <p class="hist-empty-title">${state.searchQuery ? 'No matching downloads found' : 'History is empty'}</p>
            <span class="hist-empty-sub">${state.searchQuery ? `No archived downloads match "${escHtml(state.searchQuery)}".` : 'Completed and archived downloads will be permanently cataloged here.'}</span>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  // 5. Paginated DOM Insertion
  const totalPages = Math.ceil(list.length / state.HIST_PAGE_SIZE) || 1;
  if (state.histCurrentPage > totalPages) state.histCurrentPage = totalPages;
  if (state.histCurrentPage < 1) state.histCurrentPage = 1;

  const startIdx = (state.histCurrentPage - 1) * state.HIST_PAGE_SIZE;
  const pageSlice = list.slice(startIdx, startIdx + state.HIST_PAGE_SIZE);

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  pageSlice.forEach((dl, idx) => {
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
    tr.style.setProperty('--stagger', String(Math.min(idx, 20)));

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
      <td class="col-hist-size">${(() => {
        const total = dl.total || dl.filesize || dl.fileSize || 0;
        const received = dl.received || dl.receivedBytes || 0;
        const sz = total > 0 ? total : received;
        return sz > 0 ? formatBytes(sz) : '—';
      })()}</td>
      <td class="col-hist-cat">
        <span class="chip">${escHtml((dl.category || detectCategory(dl.filename, (dl as any).mimeType)).toUpperCase())}</span>
      </td>
      <td class="col-hist-time">
        <span>${relativeTime(dl.completedAt || dl.createdAt)}</span>
        ${statusTag}
      </td>
      <td class="col-hist-actions">
        <div class="row-actions">
          ${dl.state === DOWNLOAD_STATE.COMPLETED ? `
          <button class="row-btn row-btn-folder" data-hist-act="open" data-id="${dl.id}" title="Open folder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>` : ''}
          <button class="row-btn row-btn-retry" data-hist-act="retry" data-id="${dl.id}" title="Re-download">
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

  renderPaginationControls(list.length, state.histCurrentPage, totalPages, 'history-pagination', (newPage) => {
    state.histCurrentPage = newPage;
    renderHistory();
  }, state.HIST_PAGE_SIZE);
}

export function bindHistory(): void {
  // Sortable header handlers
  document.querySelectorAll('th.sortable-hist').forEach(th => {
    th.addEventListener('click', () => {
      const col = (th as HTMLElement).dataset.sort;
      if (!col) return;
      if (state.histSortCol === col) {
        state.histSortDir = state.histSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.histSortCol = col;
        state.histSortDir = (col === 'file' || col === 'category') ? 'asc' : 'desc';
      }
      document.querySelectorAll('th.sortable-hist').forEach(t => {
        t.classList.remove('active-sort');
        const arrow = t.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = '↕';
      });
      th.classList.add('active-sort');
      const curArrow = th.querySelector('.sort-arrow');
      if (curArrow) curArrow.textContent = state.histSortDir === 'asc' ? '↑' : '↓';
      renderHistory();
    });
  });

  // Event delegation on #history-tbody
  const tbody = document.getElementById('history-tbody');
  if (tbody) {
    tbody.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('[data-hist-act]') as HTMLElement | null;
      if (!btn) return;
      const act = btn.dataset.histAct;
      const id = btn.dataset.id;
      if (!id) return;

      if (act === 'open') {
        await sendMsg({ type: MSG.SHOW_IN_FOLDER, id });
      } else if (act === 'delete') {
        await sendMsg({ type: MSG.DELETE_DOWNLOAD, id });
        delete state.downloads[id];
        renderHistory();
        updateSidebarStats();
        updateBadges();
      } else if (act === 'retry') {
        if (state.downloads[id]) {
          state.downloads[id].state = DOWNLOAD_STATE.CONNECTING;
          state.downloads[id].percent = 0;
          state.downloads[id].received = 0;
          state.downloads[id].speed = 0;
          state.downloads[id].error = null;
        }
        renderHistory();
        updateSidebarStats();
        updateBadges();
        await sendMsg({ type: MSG.RETRY_DOWNLOAD, id });
      }
    });
  }

  // Clear history button with confirmation
  document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
    const completed = Object.values(state.downloads).filter(d =>
      [DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.ERROR].includes(d.state)
    );
    if (completed.length === 0) return;

    if (!confirm(`Are you sure you want to clear all ${completed.length} items from history?`)) return;

    await sendMsg({ type: MSG.CLEAR_HISTORY });
    for (const dl of completed) {
      delete state.downloads[dl.id];
    }
    renderHistory();
    updateSidebarStats();
    updateBadges();
  });
}
