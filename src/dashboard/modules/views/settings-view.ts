// ============================================================
//  All-Downloader — Settings UI View & Configuration Persistence
// ============================================================
import { DEFAULT_SETTINGS, MSG } from '../../../shared/constants.js';
import type { ExtensionSettings } from '../../../shared/types.js';
import { state } from '../state.js';
import { sendMsg } from '../api.js';
import { updateSliderFill } from '../dom-helpers.js';

export function loadSettingsUI(): void {
  const s = { ...DEFAULT_SETTINGS, ...state.settings };

  const setVal = (id: string, val: any) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = Boolean(val);
    } else {
      el.value = val !== undefined && val !== null ? String(val) : '';
    }
  };

  setVal('setting-intercept',            s.interceptDownloads);
  setVal('setting-autostart',            s.autoStart);
  setVal('setting-max-concurrent',       s.maxConcurrent);
  setVal('setting-max-chunks',           s.maxChunks);
  setVal('setting-min-chunk-size',       s.minChunkSizeMB);
  setVal('setting-speed-limit',          s.speedLimitKBps);
  setVal('setting-save-path',            s.defaultSavePath);
  setVal('setting-organize-categories',   s.organizeByCategoryFolders);
  setVal('setting-preserve-chunks',       s.preserveChunksOnCancel);
  setVal('setting-verify-integrity',     s.verifyIntegrity);
  setVal('setting-notifications',        s.showNotifications);
  setVal('setting-max-history',          s.maxHistoryItems);

  const sMaxConcurrent = document.getElementById('setting-max-concurrent') as HTMLInputElement | null;
  const vMaxConcurrent = document.getElementById('val-max-concurrent') as HTMLElement | null;
  updateSliderFill(sMaxConcurrent, vMaxConcurrent);

  const sMaxChunks = document.getElementById('setting-max-chunks') as HTMLInputElement | null;
  const vMaxChunks = document.getElementById('val-max-chunks') as HTMLElement | null;
  updateSliderFill(sMaxChunks, vMaxChunks);

  // Keep queue slider in sync if rendered
  const qSlider = document.getElementById('q-max-concurrent') as HTMLInputElement | null;
  const qVal    = document.getElementById('q-max-val') as HTMLElement | null;
  if (qSlider) {
    qSlider.value = String(s.maxConcurrent);
    updateSliderFill(qSlider, qVal);
  }

  document.querySelectorAll('.settings-group').forEach((grp, idx) => {
    (grp as HTMLElement).style.setProperty('--stagger', String(idx));
  });
}

export function bindSettings(onResetAll: () => void): void {
  let debounceSettingsTimer: any = null;

  function debouncedAutoSave(delayMs = 150): void {
    clearTimeout(debounceSettingsTimer);
    debounceSettingsTimer = setTimeout(() => {
      saveAllSettings(true);
    }, delayMs);
  }

  const sMaxConcurrent = document.getElementById('setting-max-concurrent') as HTMLInputElement | null;
  const vMaxConcurrent = document.getElementById('val-max-concurrent') as HTMLElement | null;

  sMaxConcurrent?.addEventListener('input', () => {
    updateSliderFill(sMaxConcurrent, vMaxConcurrent);
    const qSlider = document.getElementById('q-max-concurrent') as HTMLInputElement | null;
    const qVal    = document.getElementById('q-max-val') as HTMLElement | null;
    if (qSlider) {
      qSlider.value = sMaxConcurrent.value;
      updateSliderFill(qSlider, qVal);
    }
    debouncedAutoSave(120);
  });

  const sMaxChunks = document.getElementById('setting-max-chunks') as HTMLInputElement | null;
  const vMaxChunks = document.getElementById('val-max-chunks') as HTMLElement | null;

  sMaxChunks?.addEventListener('input', () => {
    updateSliderFill(sMaxChunks, vMaxChunks);
    debouncedAutoSave(120);
  });

  async function saveAllSettings(isAutoSave = false): Promise<void> {
    clearTimeout(debounceSettingsTimer);

    const get = (id: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return null;
      if (el.type === 'checkbox') return el.checked;
      if (el.type === 'number' || el.type === 'range') return Number(el.value);
      return el.value;
    };

    const newSettings: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      ...state.settings,
      interceptDownloads:        Boolean(get('setting-intercept') ?? (state.settings?.interceptDownloads ?? DEFAULT_SETTINGS.interceptDownloads)),
      autoStart:                 Boolean(get('setting-autostart') ?? (state.settings?.autoStart ?? DEFAULT_SETTINGS.autoStart)),
      maxConcurrent:             Math.max(1, Math.min(10, Math.round(Number(get('setting-max-concurrent')) || state.settings?.maxConcurrent || DEFAULT_SETTINGS.maxConcurrent))),
      maxChunks:                 Math.max(1, Math.min(16, Math.round(Number(get('setting-max-chunks')) || state.settings?.maxChunks || DEFAULT_SETTINGS.maxChunks))),
      minChunkSizeMB:            Math.max(1, Math.min(100, Math.floor(Number(get('setting-min-chunk-size')) || state.settings?.minChunkSizeMB || DEFAULT_SETTINGS.minChunkSizeMB))),
      speedLimitKBps:            Math.max(0, Math.floor(Number(get('setting-speed-limit')) ?? (state.settings?.speedLimitKBps || 0))),
      defaultSavePath:           String(get('setting-save-path') ?? (state.settings?.defaultSavePath || '')).trim(),
      organizeByCategoryFolders: Boolean(get('setting-organize-categories') ?? (state.settings?.organizeByCategoryFolders ?? DEFAULT_SETTINGS.organizeByCategoryFolders)),
      preserveChunksOnCancel:    Boolean(get('setting-preserve-chunks') ?? (state.settings?.preserveChunksOnCancel ?? DEFAULT_SETTINGS.preserveChunksOnCancel)),
      verifyIntegrity:           Boolean(get('setting-verify-integrity') ?? (state.settings?.verifyIntegrity ?? DEFAULT_SETTINGS.verifyIntegrity)),
      showNotifications:         Boolean(get('setting-notifications') ?? (state.settings?.showNotifications ?? DEFAULT_SETTINGS.showNotifications)),
      maxHistoryItems:           Math.max(10, Math.min(9999, Math.floor(Number(get('setting-max-history')) || state.settings?.maxHistoryItems || DEFAULT_SETTINGS.maxHistoryItems))),
      darkMode:                  Boolean(state.settings?.darkMode ?? DEFAULT_SETTINGS.darkMode),
    };

    const res = await sendMsg({ type: MSG.UPDATE_SETTINGS, payload: newSettings });
    const $status = document.getElementById('save-status');

    if (res?.ok && res?.settings) {
      state.settings = res.settings;
      const qSlider = document.getElementById('q-max-concurrent') as HTMLInputElement | null;
      const qVal    = document.getElementById('q-max-val') as HTMLElement | null;
      if (qSlider) {
        qSlider.value = String(res.settings.maxConcurrent);
        updateSliderFill(qSlider, qVal);
      }
      if ($status) {
        $status.textContent = isAutoSave ? 'Saved' : 'Settings Saved';
        $status.classList.remove('error');
        $status.classList.add('visible');
        setTimeout(() => $status.classList.remove('visible'), 2000);
      }
    } else {
      if ($status) {
        $status.textContent = res?.error ? `Save Failed: ${res.error}` : 'Save Failed';
        $status.classList.add('error', 'visible');
        setTimeout(() => $status.classList.remove('visible'), 3000);
      }
    }
  }

  // Auto-save on toggle switches immediately on change
  [
    'setting-intercept',
    'setting-autostart',
    'setting-organize-categories',
    'setting-preserve-chunks',
    'setting-verify-integrity',
    'setting-notifications',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      saveAllSettings(true);
    });
  });

  // Auto-save on sliders after pointer release or keyboard change
  ['setting-max-concurrent', 'setting-max-chunks'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      clearTimeout(debounceSettingsTimer);
      saveAllSettings(true);
    });
  });

  // Auto-save on input with debounce & on change/blur/Enter for text & number inputs
  [
    'setting-min-chunk-size',
    'setting-speed-limit',
    'setting-save-path',
    'setting-max-history',
  ].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => debouncedAutoSave(350));
    el?.addEventListener('change', () => {
      clearTimeout(debounceSettingsTimer);
      saveAllSettings(true);
    });
    el?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        clearTimeout(debounceSettingsTimer);
        saveAllSettings(true);
      }
    });
  });

  document.getElementById('btn-save-settings')?.addEventListener('click', () => saveAllSettings(false));

  document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
    if (!confirm('This will permanently clear all download history and reset lifetime stats. Are you sure?')) return;
    await sendMsg({ type: MSG.CLEAR_HISTORY });
    const dlRes = await sendMsg({ type: MSG.GET_DOWNLOADS });
    if (dlRes?.downloads) {
      state.downloads = Object.fromEntries(dlRes.downloads.map((d: any) => [d.id, d]));
    } else {
      state.downloads = {};
    }
    state.histCurrentPage = 1;
    onResetAll();

    const $status = document.getElementById('save-status');
    if ($status) {
      $status.textContent = 'All Data Reset';
      $status.classList.remove('error');
      $status.classList.add('visible');
      setTimeout(() => $status.classList.remove('visible'), 2500);
    }
  });
}
