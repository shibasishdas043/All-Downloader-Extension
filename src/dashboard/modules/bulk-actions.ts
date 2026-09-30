// ============================================================
//  All-Downloader — Dashboard Bulk Operations Controller
// ============================================================
import { MSG } from '../../shared/constants.js';
import { sendMsg } from './api.js';
import { state } from './state.js';
import { getFilteredDownloads } from './filters.js';
import { updateSidebarStats, updateBadges } from './sidebar.js';

export function updateSelectAllCheckbox(visibleList = getFilteredDownloads()): void {
  const selectAll = document.getElementById('select-all') as HTMLInputElement | null;
  if (!selectAll) return;
  if (visibleList.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const visibleSelectedCount = visibleList.filter(d => state.selected.has(d.id)).length;
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

export function updateBulkBar(): void {
  const bar = document.getElementById('bulk-bar');
  const countEl = document.getElementById('bulk-count');
  if (!bar) return;

  const count = state.selected.size;
  if (count > 0) {
    bar.hidden = false;
    if (countEl) countEl.textContent = `${count} selected`;
  } else {
    bar.hidden = true;
  }
}

export async function bulkAction(msgType: string, onDone: () => void): Promise<void> {
  if (state.selected.size === 0) return;
  const ids = [...state.selected];
  for (const id of ids) {
    await sendMsg({ type: msgType, id });
    if (msgType === MSG.DELETE_DOWNLOAD) delete state.downloads[id];
  }
  if (msgType === MSG.DELETE_DOWNLOAD || msgType === MSG.CANCEL_DOWNLOAD) {
    state.selected.clear();
  }
  updateSelectAllCheckbox();
  updateBulkBar();
  updateSidebarStats();
  updateBadges();
  onDone();
}

export function bindBulkActions(onBulkDone: () => void): void {
  document.getElementById('bulk-pause')?.addEventListener('click', () => bulkAction(MSG.PAUSE_DOWNLOAD, onBulkDone));
  document.getElementById('bulk-resume')?.addEventListener('click', () => bulkAction(MSG.RESUME_DOWNLOAD, onBulkDone));
  document.getElementById('bulk-cancel')?.addEventListener('click', () => bulkAction(MSG.CANCEL_DOWNLOAD, onBulkDone));
  document.getElementById('bulk-delete')?.addEventListener('click', () => bulkAction(MSG.DELETE_DOWNLOAD, onBulkDone));
  document.getElementById('bulk-clear-sel')?.addEventListener('click', () => {
    state.selected.clear();
    document.querySelectorAll('#dl-tbody .row-check').forEach(c => (c as HTMLInputElement).checked = false);
    updateSelectAllCheckbox();
    updateBulkBar();
  });

  // Select all (tri-state aware)
  document.getElementById('select-all')?.addEventListener('change', (e) => {
    const visible = getFilteredDownloads();
    const shouldSelect = (e.target as HTMLInputElement).checked;
    for (const dl of visible) {
      if (shouldSelect) state.selected.add(dl.id);
      else state.selected.delete(dl.id);
    }
    document.querySelectorAll('#dl-tbody .row-check').forEach(cb => {
      (cb as HTMLInputElement).checked = shouldSelect;
    });
    updateSelectAllCheckbox(visible);
    updateBulkBar();
  });
}
