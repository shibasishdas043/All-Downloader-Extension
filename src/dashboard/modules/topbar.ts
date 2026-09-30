// ============================================================
//  All-Downloader — Dashboard Topbar & Search Control
// ============================================================
import { state } from './state.js';

export function bindTopbar(onSearchChange: () => void): void {
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
  if (searchInput) {
    let debounceTimer: any;
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = (e.target as HTMLInputElement).value.trim();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onSearchChange();
      }, 50);
    });
  }

  document.getElementById('btn-add-download')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-add');
    if (modal) {
      modal.hidden = false;
      setTimeout(() => (document.getElementById('dash-url-input') as HTMLInputElement | null)?.focus(), 50);
    }
  });
}
