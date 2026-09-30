// ============================================================
//  All-Downloader — Toolbar Icon Manager
//  Ensures the extension toolbar icon stays strictly static with the default icon
// ============================================================

export const DEFAULT_ICONS = {
  16:  'src/assets/icons/icon16.png',
  32:  'src/assets/icons/icon32.png',
  48:  'src/assets/icons/icon48.png',
  128: 'src/assets/icons/icon128.png',
};

/**
 * Explicitly restores and locks the toolbar icon to the default static icon.
 */
export function restoreDefaultIcon(): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.action?.setIcon) {
      chrome.action.setIcon({ path: DEFAULT_ICONS }, () => {
        // Suppress any benign errors if toolbar is busy
        if (chrome.runtime?.lastError) {
          /* no-op */
        }
      });
    }
  } catch {
    // Ignore in unloaded contexts or tests
  }
}

/**
 * Replaces previous dynamic canvas animation with clean no-op,
 * keeping the default toolbar icon intact.
 */
export function playDownloadStartAnimation(onComplete?: () => void): void {
  restoreDefaultIcon();
  if (onComplete) {
    onComplete();
  }
}

/**
 * Restores the default static icon.
 */
export function stopDownloadStartAnimation(): void {
  restoreDefaultIcon();
}
