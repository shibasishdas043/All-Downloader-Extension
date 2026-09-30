// ============================================================
//  All-Downloader — Dashboard Filtering & Sorting Engine
// ============================================================
import { DOWNLOAD_STATE, FILE_CATEGORY } from '../../shared/constants.js';
import { detectCategory, getExtension } from '../../shared/utils.js';
import { state } from './state.js';

export function getFilteredDownloads(): any[] {
  let list = Object.values(state.downloads);

  // 1. State Filter (Complete State Coverage)
  if (state.activeFilter !== 'all') {
    if (state.activeFilter === 'downloading' || state.activeFilter === 'active') {
      const activeStates = [
        DOWNLOAD_STATE.DOWNLOADING,
        DOWNLOAD_STATE.CONNECTING,
        DOWNLOAD_STATE.MERGING,
        DOWNLOAD_STATE.VERIFYING
      ];
      list = list.filter(d => activeStates.includes(d.state));
    } else if (state.activeFilter === 'error' || state.activeFilter === 'failed') {
      list = list.filter(d => d.state === DOWNLOAD_STATE.ERROR || d.state === DOWNLOAD_STATE.CANCELLED);
    } else {
      list = list.filter(d => d.state === state.activeFilter);
    }
  }

  // 2. Category Filter (Dynamic Extension Inference)
  if (state.activeCat !== 'all') {
    list = list.filter(d => {
      const cat = (d.category && d.category !== FILE_CATEGORY.OTHER)
        ? d.category
        : detectCategory(d.filename || '', (d as any).mimeType);
      return cat === state.activeCat;
    });
  }

  // 3. Multi-Token Tokenized Search Algorithm
  if (state.searchQuery) {
    const tokens = state.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(d => {
      const name = (d.filename || '').toLowerCase();
      const url = (d.url || '').toLowerCase();
      const ext = (getExtension(d.filename || '')).toLowerCase();
      const cat = (d.category || detectCategory(d.filename || '', (d as any).mimeType)).toLowerCase();
      const target = `${name} ${url} ${ext} ${cat}`;
      return tokens.every(t => target.includes(t));
    });
  }

  // 4. Industry-Grade Multi-Key Stable Sorting
  list.sort((a, b) => {
    let result = 0;
    if (state.sortCol === 'filename') {
      result = (a.filename || '').localeCompare(b.filename || '', undefined, { numeric: true, sensitivity: 'base' });
    } else if (state.sortCol === 'total') {
      const szA = a.total > 0 ? a.total : (a.received || 0);
      const szB = b.total > 0 ? b.total : (b.received || 0);
      result = szA - szB;
    } else if (state.sortCol === 'speed') {
      const spA = a.state === DOWNLOAD_STATE.DOWNLOADING ? (a.speed || 0) : -1;
      const spB = b.state === DOWNLOAD_STATE.DOWNLOADING ? (b.speed || 0) : -1;
      result = spA - spB;
    } else if (state.sortCol === 'percent') {
      result = (a.percent || 0) - (b.percent || 0);
    } else if (state.sortCol === 'state') {
      result = (a.state || '').localeCompare(b.state || '');
    } else {
      result = (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    }

    if (result === 0) {
      // Deterministic tie-breaker: newest first
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    }
    return state.sortDir === 'asc' ? result : -result;
  });

  return list;
}

export function bindFilters(onFilterChange: () => void): void {
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = (btn as HTMLElement).dataset.filter || 'all';
      onFilterChange();
    });
  });

  document.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeCat = (btn as HTMLElement).dataset.cat || 'all';
      onFilterChange();
    });
  });

  // Sortable headers
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = (th as HTMLElement).dataset.sort;
      if (!col) return;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = (col === 'filename' || col === 'state') ? 'asc' : 'desc';
      }
      document.querySelectorAll('th.sortable').forEach(t => {
        t.classList.remove('active-sort');
        const arrow = t.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = '↕';
      });
      th.classList.add('active-sort');
      const curArrow = th.querySelector('.sort-arrow');
      if (curArrow) curArrow.textContent = state.sortDir === 'asc' ? '↑' : '↓';
      onFilterChange();
    });
  });
}
