// ============================================================
//  All-Downloader — Download Started In-Page Toast Dispatcher
//  Displays toast notification on the active web page below toolbar
// ============================================================
import { displayInPageToast } from '../../content/toast.js';

export function showDownloadStartedToast(filename: string): void {
  try {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime?.lastError || !tabs || tabs.length === 0) {
        chrome.tabs.query({ active: true, currentWindow: true }, (fallback) => {
          dispatchToastToTab(fallback?.[0], filename);
        });
        return;
      }
      dispatchToastToTab(tabs[0], filename);
    });
  } catch (err) {
    console.warn('[ADL Toast] Error querying tabs:', err);
  }
}

function dispatchToastToTab(tab: chrome.tabs.Tab | undefined, filename: string): void {
  if (!tab?.id || !tab.url) return;
  // Ignore privileged browser schemes where extensions cannot inject DOM
  if (
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('chrome-extension://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('about:') ||
    tab.url.startsWith('view-source:')
  ) {
    return;
  }

  const tabId = tab.id;

  if (chrome.scripting) {
    chrome.scripting.executeScript({
      target: { tabId },
      func: displayInPageToast,
      args: [filename],
    }).catch((err) => {
      console.debug('[ADL Toast] Could not inject toast into tab:', err);
    });
  }
}
