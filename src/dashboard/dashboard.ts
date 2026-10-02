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

  // Keep sidebar navigation in sync
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', (b as HTMLElement).dataset.view === view);
  });

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

    case MSG.DOWNLOAD_RESUMED:
      if (state.downloads[msg.id]) {
        if (msg.download) Object.assign(state.downloads[msg.id], msg.download);
        if (state.downloads[msg.id].state !== DOWNLOAD_STATE.QUEUED) {
          state.downloads[msg.id].state = DOWNLOAD_STATE.CONNECTING;
          state.downloads[msg.id].status = DOWNLOAD_STATE.CONNECTING;
        }
        state.downloads[msg.id].error = null;
        state.downloads[msg.id].errorMessage = null;
        updateTableRowState(msg.id);
        updateSidebarStats();
        updateBadges();
      }
      break;

    case MSG.DOWNLOAD_PROGRESS:
      if (!state.downloads[msg.id]) {
        state.downloads[msg.id] = {
          id: msg.id,
          state: msg.state || DOWNLOAD_STATE.DOWNLOADING,
          status: msg.state || DOWNLOAD_STATE.DOWNLOADING,
          received: msg.received, total: msg.total,
          percent: msg.percent, speed: msg.speed, eta: msg.eta,
          ...(msg.segments ? { segments: msg.segments } : {}),
          ...(msg.totalChunks ? { totalChunks: msg.totalChunks } : {}),
        };
        if (state.currentView === 'downloads') renderDownloadsTable();
      } else {
        const prevState = state.downloads[msg.id].state;
        const nextState = msg.state || DOWNLOAD_STATE.DOWNLOADING;
        Object.assign(state.downloads[msg.id], {
          state: nextState,
          status: nextState,
          received: msg.received, total: msg.total,
          percent: msg.percent, speed: msg.speed, eta: msg.eta,
          ...(msg.segments ? { segments: msg.segments } : {}),
          ...(msg.totalChunks ? { totalChunks: msg.totalChunks } : {}),
        });
        if (prevState !== nextState && state.currentView === 'downloads') {
          updateTableRowState(msg.id);
          updateSidebarStats();
          updateBadges();
        }
        queueProgressUpdate(msg.id);
      }
      break;

    case MSG.DOWNLOAD_COMPLETED:
    case MSG.DOWNLOAD_PAUSED:
    case MSG.DOWNLOAD_CANCELLED:
    case MSG.DOWNLOAD_ERROR:
      if (state.downloads[msg.id]) {
        if (msg.type === MSG.DOWNLOAD_COMPLETED) {
          state.downloads[msg.id].state = DOWNLOAD_STATE.COMPLETED;
          state.downloads[msg.id].status = DOWNLOAD_STATE.COMPLETED;
          const sz = msg.total || msg.filesize || msg.received || msg.receivedBytes;
          if (sz) {
            state.downloads[msg.id].total = sz;
            state.downloads[msg.id].filesize = sz;
            state.downloads[msg.id].received = sz;
            state.downloads[msg.id].receivedBytes = sz;
          }
          if (msg.filename) {
            state.downloads[msg.id].filename = msg.filename;
          }
          if (msg.download) {
            Object.assign(state.downloads[msg.id], msg.download);
          }
        }
        if (msg.type === MSG.DOWNLOAD_PAUSED) state.downloads[msg.id].state = DOWNLOAD_STATE.PAUSED;
        if (msg.type === MSG.DOWNLOAD_CANCELLED) {
          state.downloads[msg.id].state = DOWNLOAD_STATE.CANCELLED;
          state.downloads[msg.id].speed = 0;
          state.downloads[msg.id].eta = 0;
        }
        if (msg.type === MSG.DOWNLOAD_ERROR) {
          state.downloads[msg.id].state = DOWNLOAD_STATE.ERROR;
          state.downloads[msg.id].speed = 0;
          state.downloads[msg.id].eta = 0;
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

    case MSG.DOWNLOAD_DELETED:
      if (state.downloads[msg.id]) {
        delete state.downloads[msg.id];
        state.selected.delete(msg.id);
        state.expandedChunkIds.delete(msg.id);
        if (state.currentView === 'downloads') renderDownloadsTable();
        if (state.currentView === 'history') renderHistory();
        if (state.currentView === 'queue') renderQueue();
        if (state.currentView === 'stats') renderStats();
        updateSidebarStats();
        updateBadges();
      }
      break;

    case MSG.CLEAR_HISTORY:
      for (const id of Object.keys(state.downloads)) {
        const dl = state.downloads[id];
        const st = dl.status || (dl as any).state;
        if (![
          DOWNLOAD_STATE.DOWNLOADING,
          DOWNLOAD_STATE.QUEUED,
          DOWNLOAD_STATE.CONNECTING,
          DOWNLOAD_STATE.PAUSED,
          DOWNLOAD_STATE.MERGING,
          DOWNLOAD_STATE.VERIFYING
        ].includes(st as any)) {
          delete state.downloads[id];
          state.selected.delete(id);
          state.expandedChunkIds.delete(id);
        }
      }
      if (state.currentView === 'downloads') renderDownloadsTable();
      if (state.currentView === 'history') renderHistory();
      if (state.currentView === 'queue') renderQueue();
      if (state.currentView === 'stats') renderStats();
      updateSidebarStats();
      updateBadges();
      break;

    case MSG.SETTINGS_UPDATED:
      if (msg.settings) {
        state.settings = msg.settings;
        loadSettingsUI();
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

  if (setRes?.settings) {
    state.settings = setRes.settings;
  }
  loadSettingsUI();

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

  const manifest = chrome.runtime?.getManifest?.();
  if (manifest?.version) {
    const brandVer = document.querySelector('.brand-version');
    if (brandVer) brandVer.textContent = `v${manifest.version}`;
  }

  function getInitialView(): string {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view') || window.location.hash.replace(/^#/, '');
    const validViews = ['downloads', 'queue', 'history', 'stats', 'settings'];
    return validViews.includes(viewParam) ? viewParam : 'downloads';
  }

  renderView(getInitialView());

  window.addEventListener('popstate', () => {
    renderView(getInitialView());
  });
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
