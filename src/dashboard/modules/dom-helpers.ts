// ============================================================
//  All-Downloader — Dashboard DOM & Pagination Helpers
// ============================================================
import { state } from './state.js';

export function escHtml(str: any): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function updateSliderFill(slider: HTMLInputElement | null, valSpan: HTMLElement | null): void {
  if (!slider) return;
  const min = Number(slider.min) || 1;
  const max = Number(slider.max) || 100;
  const val = Number(slider.value);
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  slider.style.background = `linear-gradient(to right, var(--geist-ink) 0%, var(--geist-ink) ${pct}%, var(--bg-track) ${pct}%, var(--bg-track) 100%)`;
  if (valSpan) valSpan.textContent = String(val);
}

export function renderPaginationControls(
  totalCount: number,
  page: number,
  totalPages: number,
  containerId: string,
  onPageChange: (p: number) => void,
  pageSize: number = state.PAGE_SIZE
): void {
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'table-pagination-bar';
    const targetWrapId = containerId === 'dl-pagination' ? 'table-wrap' : 'history-table-wrap';
    const tableWrap = document.getElementById(targetWrapId);
    if (tableWrap) tableWrap.appendChild(container);
    else return;
  }

  if (totalCount <= pageSize) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  container.hidden = false;
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalCount);

  container.innerHTML = `
    <span class="pagination-info">Showing ${startItem}–${endItem} of ${totalCount}</span>
    <div class="pagination-buttons">
      <button class="pagination-btn" id="${containerId}-prev" ${page <= 1 ? 'disabled' : ''}>
        ← Prev
      </button>
      <span class="pagination-current">Page ${page} of ${totalPages}</span>
      <button class="pagination-btn" id="${containerId}-next" ${page >= totalPages ? 'disabled' : ''}>
        Next →
      </button>
    </div>
  `;

  container.querySelector(`#${containerId}-prev`)?.addEventListener('click', () => {
    if (page > 1) onPageChange(page - 1);
  });
  container.querySelector(`#${containerId}-next`)?.addEventListener('click', () => {
    if (page < totalPages) onPageChange(page + 1);
  });
}
