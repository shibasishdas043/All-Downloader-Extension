// ============================================================
//  All-Downloader — Dashboard Main Controller
// ============================================================
import { MSG, DOWNLOAD_STATE } from '../shared/constants.js';
import {
  state,
  sendMsg,
  bindNav,
  updateSidebarStats,
  updateBadges,
  bindTopbar,
  bindFilters,
  bindModal,
  bindBulkActions,
  renderDownloadsTable,
  updateTableRowState,
  bindTableDelegation,
  queueProgressUpdate,
  renderHistory,
  bindHistory,
  renderQueue,
  bindQueue,
  renderStats,
  loadSettingsUI,
  bindSettings,
} from './modules/index.js';

export function renderView(view: string): void {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');

  // Memory optimization: deallocate canvas backing store when switching away from stats
  if (view !== 'stats') {
    const canvas = document.getElementById('chart-category') as HTMLCanvasElement | null;
    if (canvas && (canvas.width > 1 || canvas.height > 1)) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  const titles: Record<string, [string, string]> = {
    downloads: ['Downloads', 'All active & recent'],
    queue:     ['Queue', 'Manage download order & scheduling'],
    history:   ['History', 'Completed & past downloads'],
    stats:     ['Statistics', 'Lifetime download analytics'],
    settings:  ['Settings', 'Configure All Downloader'],
  };

  const [title, sub] = titles[view] || ['Dashboard', ''];
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub;

  if (view === 'downloads') renderDownloadsTable();
  if (view === 'history')   renderHistory();
  if (view === 'stats')     renderStats();
  if (view === 'settings')  loadSettingsUI();
  if (view === 'queue')     renderQueue();
}

export function handleSWMessage(msg: any): void {
  switch (msg.type) {
    case MSG.DOWNLOAD_ADDED:
      state.downloads[msg.download.id] = msg.download;
      if (state.currentView === 'downloads') renderDownloadsTable();
      updateSidebarStats();
      updateBadges();
      break;

    case MSG.DOWNLOAD_PROGRESS:
      if (!state.downloads[msg.id]) {
        state.downloads[msg.id] = {
          id: msg.id,
          state: DOWNLOAD_STATE.DOWNLOADING,
          received: msg.received, total: msg.total,
          percent: msg.percent, speed: msg.speed, eta: msg.eta,
        };
        if (state.currentView === 'downloads') renderDownloadsTable();
      } else {
        Object.assign(state.downloads[msg.id], {
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
      if (state.downloads[msg.id]) {
        if (msg.type === MSG.DOWNLOAD_COMPLETED) state.downloads[msg.id].state = DOWNLOAD_STATE.COMPLETED;
        if (msg.type === MSG.DOWNLOAD_PAUSED)    state.downloads[msg.id].state = DOWNLOAD_STATE.PAUSED;
        if (msg.type === MSG.DOWNLOAD_CANCELLED) state.downloads[msg.id].state = DOWNLOAD_STATE.CANCELLED;
        if (msg.type === MSG.DOWNLOAD_ERROR) {
          state.downloads[msg.id].state = DOWNLOAD_STATE.ERROR;
          if (msg.error) state.downloads[msg.id].error = msg.error;
        }
        updateTableRowState(msg.id);
        updateSidebarStats();
        updateBadges();
        if (state.currentView === 'history' && [MSG.DOWNLOAD_COMPLETED, MSG.DOWNLOAD_CANCELLED, MSG.DOWNLOAD_ERROR].includes(msg.type)) renderHistory();
        if (state.currentView === 'queue') renderQueue();
        if (state.currentView === 'stats') renderStats();
      }
      break;
  }
}

async function init(): Promise<void> {
  // Load all initial data from background
  const [dlRes, setRes] = await Promise.all([
    sendMsg({ type: MSG.GET_DOWNLOADS }),
    sendMsg({ type: MSG.GET_SETTINGS }),
  ]);

  if (setRes?.settings) state.settings = setRes.settings;

  if (dlRes?.downloads) {
    // Memory optimization: Prune items exceeding maxHistoryItems to bound memory footprint
    const maxItems = state.settings?.maxHistoryItems || 500;
    const sorted = dlRes.downloads.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
    const kept = sorted.slice(0, maxItems);
    kept.forEach((d: any) => { state.downloads[d.id] = d; });
  }
  if (dlRes?.queueOrder) state.latestQueueOrder = dlRes.queueOrder;

  // Listen for live updates from background service worker
  chrome.runtime.onMessage.addListener(handleSWMessage);

  bindNav((view) => renderView(view));
  bindTopbar(() => {
    if (state.currentView === 'history') renderHistory();
    else renderDownloadsTable();
  });
  bindFilters(() => renderDownloadsTable());
  bindModal();
  bindSettings(() => renderView(state.currentView));
  bindQueue();
  bindHistory();
  bindBulkActions(() => renderDownloadsTable());
  bindTableDelegation();

  updateSidebarStats();
  updateBadges();

  renderView('downloads');
}

let resizeTimer: any = null;
window.addEventListener('resize', () => {
  if (state.currentView === 'stats') {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.currentView === 'stats') renderStats();
    }, 150);
  }
});

init().catch(console.error);
