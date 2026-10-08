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

  document.getElementById('btn-add-download')?.addEventListener('click', async () => {
    const modal = document.getElementById('modal-add');
    if (modal) {
      modal.hidden = false;
      const urlInput = document.getElementById('dash-url-input') as HTMLInputElement | null;
      if (urlInput && !urlInput.value) {
        try {
          const text = await navigator.clipboard.readText();
          const trimmed = text ? text.trim() : '';
          if (trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('ftp://'))) {
            urlInput.value = trimmed;
            setTimeout(() => (document.getElementById('dash-filename-input') as HTMLInputElement | null)?.focus(), 50);
            return;
          }
        } catch {
          // Clipboard read denied / unavailable
        }
      }
      setTimeout(() => urlInput?.focus(), 50);
    }
  });
}
