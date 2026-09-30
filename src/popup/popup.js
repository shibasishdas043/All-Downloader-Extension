// src/shared/constants.ts
var DOWNLOAD_STATE = Object.freeze({
  QUEUED: "queued",
  CONNECTING: "connecting",
  DOWNLOADING: "downloading",
  PAUSED: "paused",
  MERGING: "merging",
  VERIFYING: "verifying",
  COMPLETED: "completed",
  ERROR: "error",
  CANCELLED: "cancelled"
});
var FILE_CATEGORY = Object.freeze({
  VIDEO: "video",
  AUDIO: "audio",
  IMAGE: "image",
  DOCUMENT: "document",
  ARCHIVE: "archive",
  APPLICATION: "application",
  OTHER: "other"
});
var CATEGORY_MAP = Object.freeze({
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg"],
  audio: ["mp3", "aac", "flac", "wav", "ogg", "m4a", "wma", "opus"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tiff"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "json", "xml"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"],
  application: ["exe", "msi", "dmg", "apk", "deb", "rpm", "pkg"]
});
var MSG = Object.freeze({
  // SW → UI
  DOWNLOAD_ADDED: "DOWNLOAD_ADDED",
  DOWNLOAD_PROGRESS: "DOWNLOAD_PROGRESS",
  DOWNLOAD_COMPLETED: "DOWNLOAD_COMPLETED",
  DOWNLOAD_ERROR: "DOWNLOAD_ERROR",
  DOWNLOAD_PAUSED: "DOWNLOAD_PAUSED",
  DOWNLOAD_RESUMED: "DOWNLOAD_RESUMED",
  DOWNLOAD_CANCELLED: "DOWNLOAD_CANCELLED",
  STATE_SNAPSHOT: "STATE_SNAPSHOT",
  // UI → SW
  GET_DOWNLOADS: "GET_DOWNLOADS",
  PAUSE_DOWNLOAD: "PAUSE_DOWNLOAD",
  RESUME_DOWNLOAD: "RESUME_DOWNLOAD",
  CANCEL_DOWNLOAD: "CANCEL_DOWNLOAD",
  RETRY_DOWNLOAD: "RETRY_DOWNLOAD",
  START_DOWNLOAD: "START_DOWNLOAD",
  DELETE_DOWNLOAD: "DELETE_DOWNLOAD",
  UPDATE_SETTINGS: "UPDATE_SETTINGS",
  GET_SETTINGS: "GET_SETTINGS",
  CLEAR_HISTORY: "CLEAR_HISTORY",
  OPEN_DASHBOARD: "OPEN_DASHBOARD",
  PRIORITIZE_DOWNLOAD: "PRIORITIZE_DOWNLOAD",
  MOVE_QUEUE_ITEM: "MOVE_QUEUE_ITEM",
  START_QUEUED_NOW: "START_QUEUED_NOW",
  CLEAR_QUEUE: "CLEAR_QUEUE",
  SHOW_IN_FOLDER: "SHOW_IN_FOLDER"
});
var STORAGE_KEY = Object.freeze({
  DOWNLOADS: "all_downloader_downloads",
  SETTINGS: "all_downloader_settings",
  STATS: "all_downloader_stats"
});
var DEFAULT_SETTINGS = Object.freeze({
  maxConcurrent: 3,
  // max simultaneous downloads
  maxChunks: 8,
  // segments per file
  minChunkSizeMB: 2,
  // min file size to chunk (MB)
  speedLimitKBps: 0,
  // 0 = unlimited
  defaultSavePath: "",
  // empty = browser default
  autoStart: true,
  // auto-start queued downloads
  showNotifications: true,
  // OS notifications on complete
  verifyIntegrity: true,
  // SHA-256 check when server provides hash
  interceptDownloads: true,
  // intercept all browser downloads
  darkMode: true,
  maxHistoryItems: 500
});
var UI = Object.freeze({
  POPUP_MAX_VISIBLE: 7,
  // max download items in popup
  PROGRESS_INTERVAL: 500,
  // ms between progress broadcasts
  SPEED_SAMPLE_WINDOW: 3e3
  // ms window for speed average
});
var COLORS = Object.freeze({
  skyBlue: "#8ecae6",
  ocean: "#219ebc",
  navy: "#023047",
  amber: "#ffb703",
  orange: "#fb8500"
});

// src/shared/utils.ts
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, safeI)).toFixed(dm))} ${sizes[safeI]}`;
}
function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0 || isNaN(bytesPerSec)) return "0 B/s";
  return `${formatBytes(bytesPerSec, 1)}/s`;
}
function formatETA(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function getExtension(filename) {
  if (!filename) return "";
  const parts = filename.split(".");
  return parts.length > 1 ? (parts[parts.length - 1] || "").toLowerCase() : "";
}
function truncateName(name, max = 32) {
  if (!name || name.length <= max) return name;
  const ext = getExtension(name);
  const base = name.slice(0, name.length - ext.length - (ext ? 1 : 0));
  const truncated = base.slice(0, Math.max(0, max - ext.length - 4));
  return `${truncated}...${ext ? "." + ext : ""}`;
}
function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// src/popup/popup.ts
var downloads = {};
var $list = document.getElementById("download-list");
var $empty = document.getElementById("empty-state");
var $statusActive = document.getElementById("status-active");
var $statusSpeed = document.getElementById("status-speed");
var $statusQueue = document.getElementById("status-queue");
var $modalAdd = document.getElementById("modal-add");
var $urlInput = document.getElementById("url-input");
var $filenameInput = document.getElementById("filename-input");
var $tmpl = document.getElementById("tmpl-download-item");
async function init() {
  const res = await sendMsg({ type: MSG.GET_DOWNLOADS });
  if (res?.downloads) {
    for (const dl of res.downloads) downloads[dl.id] = dl;
  }
  renderAll();
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.get("adl_autoOpened", ({ adl_autoOpened }) => {
      if (!adl_autoOpened) return;
      chrome.storage.session.remove("adl_autoOpened");
      let autoCloseTimer = setTimeout(() => window.close(), 3e3);
      const cancelAutoClose = () => {
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
        document.removeEventListener("mousemove", cancelAutoClose);
        document.removeEventListener("mousedown", cancelAutoClose);
      };
      document.addEventListener("mousemove", cancelAutoClose);
      document.addEventListener("mousedown", cancelAutoClose);
    });
  }
  chrome.runtime.onMessage.addListener(handleSWMessage);
  $list.addEventListener("click", (e) => {
    const target = e.target;
    const btn = target?.closest(".ctrl-btn");
    if (!btn) return;
    const item = btn.closest(".dl-item");
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;
    if (btn.classList.contains("ctrl-pause")) pauseDl(id);
    if (btn.classList.contains("ctrl-resume")) resumeDl(id);
    if (btn.classList.contains("ctrl-cancel")) cancelDl(id);
    if (btn.classList.contains("ctrl-remove")) deleteDl(id);
    if (btn.classList.contains("ctrl-folder")) showInFolder(id);
    if (btn.classList.contains("ctrl-retry")) retryDl(id);
  });
  document.getElementById("btn-dashboard")?.addEventListener("click", openDashboard);
  document.getElementById("btn-add")?.addEventListener("click", showModal);
  document.getElementById("modal-close")?.addEventListener("click", hideModal);
  document.getElementById("btn-start-download")?.addEventListener("click", startManualDownload);
  document.getElementById("btn-pause-all")?.addEventListener("click", pauseAll);
  document.getElementById("btn-view-all")?.addEventListener("click", openDashboard);
  $modalAdd.addEventListener("click", (e) => {
    if (e.target === $modalAdd) hideModal();
  });
  $urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startManualDownload();
  });
}
function handleSWMessage(msg) {
  switch (msg?.type) {
    case MSG.DOWNLOAD_ADDED:
      downloads[msg.download.id] = msg.download;
      renderAll();
      break;
    case MSG.DOWNLOAD_PROGRESS:
      if (downloads[msg.id]) {
        const curState = downloads[msg.id].state || downloads[msg.id].status;
        if ([DOWNLOAD_STATE.CANCELLED, DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.PAUSED].includes(curState)) {
          return;
        }
        const nextState = msg.state === DOWNLOAD_STATE.MERGING ? DOWNLOAD_STATE.MERGING : DOWNLOAD_STATE.DOWNLOADING;
        Object.assign(downloads[msg.id], {
          state: nextState,
          status: nextState,
          received: msg.received,
          receivedBytes: msg.received,
          total: msg.total,
          filesize: msg.total,
          percent: msg.percent,
          progress: msg.percent,
          speed: msg.speed,
          eta: msg.eta
        });
        updateItem(msg.id);
        updateStatusBar();
      }
      break;
    case MSG.DOWNLOAD_COMPLETED:
    case MSG.DOWNLOAD_PAUSED:
    case MSG.DOWNLOAD_CANCELLED:
    case MSG.DOWNLOAD_ERROR:
      if (downloads[msg.id]) {
        if (msg.type === MSG.DOWNLOAD_COMPLETED) {
          downloads[msg.id].state = DOWNLOAD_STATE.COMPLETED;
          downloads[msg.id].status = DOWNLOAD_STATE.COMPLETED;
        }
        if (msg.type === MSG.DOWNLOAD_PAUSED) {
          downloads[msg.id].state = DOWNLOAD_STATE.PAUSED;
          downloads[msg.id].status = DOWNLOAD_STATE.PAUSED;
        }
        if (msg.type === MSG.DOWNLOAD_CANCELLED) {
          downloads[msg.id].state = DOWNLOAD_STATE.CANCELLED;
          downloads[msg.id].status = DOWNLOAD_STATE.CANCELLED;
        }
        if (msg.type === MSG.DOWNLOAD_ERROR) {
          downloads[msg.id].state = DOWNLOAD_STATE.ERROR;
          downloads[msg.id].status = DOWNLOAD_STATE.ERROR;
          downloads[msg.id].error = msg.error;
          downloads[msg.id].errorMessage = msg.error;
        }
        updateItem(msg.id);
        updateStatusBar();
      }
      break;
  }
}
function renderAll() {
  const ACTIVE_STATES = [
    DOWNLOAD_STATE.QUEUED,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING
  ];
  const isActive = (dl) => ACTIVE_STATES.includes(dl.status || dl.state);
  const sorted = Object.values(downloads).sort((a, b) => {
    const aActive = isActive(a);
    const bActive = isActive(b);
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (aActive) return a.createdAt - b.createdAt;
    return b.createdAt - a.createdAt;
  }).slice(0, UI.POPUP_MAX_VISIBLE);
  const needed = new Set(sorted.map((dl) => dl.id));
  [...$list.querySelectorAll(".dl-item")].forEach((el) => {
    const item = el;
    if (!needed.has(item.dataset.id)) item.remove();
  });
  let refNode = $empty.nextSibling;
  for (const dl of sorted) {
    let el = $list.querySelector(`.dl-item[data-id="${dl.id}"]`);
    if (!el) {
      const node = $tmpl.content.cloneNode(true);
      el = node.querySelector(".dl-item");
      el.dataset.id = dl.id;
      el.dataset.state = dl.state || dl.status;
      $list.insertBefore(node, refNode);
      el = $list.querySelector(`.dl-item[data-id="${dl.id}"]`);
    } else if (el !== refNode) {
      $list.insertBefore(el, refNode);
    }
    if (el) {
      populateItem(el, dl);
      refNode = el.nextSibling;
    }
  }
  $empty.style.display = sorted.length === 0 ? "flex" : "none";
  updateStatusBar();
}
function updateItem(id) {
  const el = $list.querySelector(`.dl-item[data-id="${id}"]`);
  if (!el) {
    renderAll();
    return;
  }
  const dl = downloads[id];
  el.dataset.state = dl.state || dl.status;
  populateItem(el, dl);
  renderAll();
}
function populateItem(el, dl) {
  const ext = getExtension(dl.filename);
  const badgeEl = el.querySelector(".dl-ext-badge");
  if (ext) {
    badgeEl.textContent = ext.slice(0, 4).toUpperCase();
  } else {
    badgeEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }
  el.querySelector(".dl-name").textContent = truncateName(dl.filename, 30);
  const total = dl.total || dl.filesize || 0;
  const received = dl.received || dl.receivedBytes || 0;
  const sizeStr = total > 0 ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
  el.querySelector(".dl-meta").textContent = sizeStr;
  const pct = dl.percent ?? dl.progress ?? 0;
  el.querySelector(".dl-progress-fill").style.width = `${pct}%`;
  const stateBadgeLabels = {
    [DOWNLOAD_STATE.QUEUED]: "Queued",
    [DOWNLOAD_STATE.CONNECTING]: "Connecting",
    [DOWNLOAD_STATE.PAUSED]: "Paused",
    [DOWNLOAD_STATE.COMPLETED]: "Done",
    [DOWNLOAD_STATE.ERROR]: "Error",
    [DOWNLOAD_STATE.CANCELLED]: "Cancelled",
    [DOWNLOAD_STATE.MERGING]: "Saving",
    [DOWNLOAD_STATE.VERIFYING]: "Verifying"
  };
  const speedEl = el.querySelector(".dl-speed");
  const pctEl = el.querySelector(".dl-percent");
  const etaEl = el.querySelector(".dl-eta");
  const st = dl.status || dl.state;
  if (st === DOWNLOAD_STATE.DOWNLOADING) {
    speedEl.textContent = formatSpeed(dl.speed);
    pctEl.textContent = `${pct}%`;
    etaEl.textContent = dl.eta ? `\xB7 ${formatETA(dl.eta)}` : "";
  } else {
    speedEl.textContent = stateBadgeLabels[st] || "";
    pctEl.textContent = `${pct}%`;
    etaEl.textContent = "";
  }
  speedEl.classList.toggle("fast", (dl.speed || 0) > 1024 * 1024);
  const needsCancel = [
    DOWNLOAD_STATE.QUEUED,
    DOWNLOAD_STATE.CONNECTING,
    DOWNLOAD_STATE.DOWNLOADING,
    DOWNLOAD_STATE.PAUSED,
    DOWNLOAD_STATE.MERGING,
    DOWNLOAD_STATE.VERIFYING
  ].includes(st);
  const isCompleted = st === DOWNLOAD_STATE.COMPLETED;
  const isFailed = st === DOWNLOAD_STATE.CANCELLED || st === DOWNLOAD_STATE.ERROR;
  const isActive = st === DOWNLOAD_STATE.DOWNLOADING || st === DOWNLOAD_STATE.CONNECTING;
  const isPaused = st === DOWNLOAD_STATE.PAUSED;
  el.querySelector(".ctrl-pause")?.classList.toggle("hidden", !isActive);
  el.querySelector(".ctrl-resume")?.classList.toggle("hidden", !isPaused);
  el.querySelector(".ctrl-cancel")?.classList.toggle("hidden", !needsCancel);
  el.querySelector(".ctrl-folder")?.classList.toggle("hidden", !isCompleted);
  el.querySelector(".ctrl-retry")?.classList.toggle("hidden", !isFailed);
  el.querySelector(".ctrl-remove")?.classList.toggle("hidden", !(isCompleted || isFailed));
}
function updateStatusBar() {
  const all = Object.values(downloads);
  const active = all.filter((d) => (d.status || d.state) === DOWNLOAD_STATE.DOWNLOADING);
  const queued = all.filter((d) => (d.status || d.state) === DOWNLOAD_STATE.QUEUED);
  const totalSpeed = active.reduce((s, d) => s + (d.speed || 0), 0);
  $statusActive.textContent = `${active.length} active`;
  $statusSpeed.textContent = formatSpeed(totalSpeed);
  $statusQueue.textContent = `Queue: ${queued.length}`;
}
async function pauseDl(id) {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.PAUSED;
    downloads[id].status = DOWNLOAD_STATE.PAUSED;
    downloads[id].speed = 0;
    downloads[id].eta = null;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.PAUSE_DOWNLOAD, id });
}
async function resumeDl(id) {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.CONNECTING;
    downloads[id].status = DOWNLOAD_STATE.CONNECTING;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.RESUME_DOWNLOAD, id });
}
async function cancelDl(id) {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.CANCELLED;
    downloads[id].status = DOWNLOAD_STATE.CANCELLED;
    downloads[id].speed = 0;
    downloads[id].eta = null;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.CANCEL_DOWNLOAD, id });
}
async function deleteDl(id) {
  delete downloads[id];
  document.querySelector(`.dl-item[data-id="${id}"]`)?.remove();
  const remaining = Object.values(downloads).sort((a, b) => b.createdAt - a.createdAt).slice(0, UI.POPUP_MAX_VISIBLE);
  $empty.style.display = remaining.length === 0 ? "flex" : "none";
  updateStatusBar();
  await sendMsg({ type: MSG.DELETE_DOWNLOAD, id });
}
async function retryDl(id) {
  if (downloads[id]) {
    downloads[id].state = DOWNLOAD_STATE.QUEUED;
    downloads[id].status = DOWNLOAD_STATE.QUEUED;
    downloads[id].error = null;
    downloads[id].errorMessage = null;
    downloads[id].percent = 0;
    downloads[id].progress = 0;
    downloads[id].received = 0;
    downloads[id].receivedBytes = 0;
    updateItem(id);
    updateStatusBar();
  }
  await sendMsg({ type: MSG.RETRY_DOWNLOAD, id });
}
async function showInFolder(id) {
  await sendMsg({ type: MSG.SHOW_IN_FOLDER, id });
}
async function pauseAll() {
  const active = Object.values(downloads).filter((d) => (d.status || d.state) === DOWNLOAD_STATE.DOWNLOADING);
  for (const dl of active) await pauseDl(dl.id);
}
async function startManualDownload() {
  const url = $urlInput.value.trim();
  if (!isValidUrl(url)) {
    $urlInput.style.borderColor = "var(--orange)";
    $urlInput.focus();
    setTimeout(() => {
      $urlInput.style.borderColor = "";
    }, 1500);
    return;
  }
  const filename = $filenameInput.value.trim() || void 0;
  hideModal();
  await sendMsg({ type: MSG.START_DOWNLOAD, payload: { url, filename } });
}
function openDashboard() {
  sendMsg({ type: MSG.OPEN_DASHBOARD });
  window.close();
}
function showModal() {
  $modalAdd.hidden = false;
  setTimeout(() => $urlInput.focus(), 50);
}
function hideModal() {
  $modalAdd.hidden = true;
  $urlInput.value = "";
  $filenameInput.value = "";
}
function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res));
  });
}
init().catch(console.error);
