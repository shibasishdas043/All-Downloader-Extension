// ============================================================
//  All-Downloader — Settings UI View & Configuration Persistence
// ============================================================
import { DEFAULT_SETTINGS, MSG } from '../../../shared/constants.js';
import { state } from '../state.js';
import { sendMsg } from '../api.js';
import { updateSliderFill } from '../dom-helpers.js';

export function loadSettingsUI(): void {
  const s = { ...DEFAULT_SETTINGS, ...state.settings };

  const setVal = (id: string, val: any) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val;
    else el.value = val ?? '';
  };

  setVal('setting-intercept',        s.interceptDownloads);
  setVal('setting-autostart',        s.autoStart);
  setVal('setting-max-concurrent',   s.maxConcurrent);
  setVal('setting-max-chunks',       s.maxChunks);
  setVal('setting-speed-limit',      s.speedLimitKBps);
  setVal('setting-verify-integrity', s.verifyIntegrity);
  setVal('setting-notifications',    s.showNotifications);
  setVal('setting-max-history',      s.maxHistoryItems);

  const sMaxConcurrent = document.getElementById('setting-max-concurrent') as HTMLInputElement | null;
  const vMaxConcurrent = document.getElementById('val-max-concurrent') as HTMLElement | null;
  updateSliderFill(sMaxConcurrent, vMaxConcurrent);

  const sMaxChunks = document.getElementById('setting-max-chunks') as HTMLInputElement | null;
  const vMaxChunks = document.getElementById('val-max-chunks') as HTMLElement | null;
  updateSliderFill(sMaxChunks, vMaxChunks);

  document.querySelectorAll('.settings-group').forEach((grp, idx) => {
    (grp as HTMLElement).style.setProperty('--stagger', String(idx));
  });
}

export function bindSettings(onResetAll: () => void): void {
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
  });

  const sMaxChunks = document.getElementById('setting-max-chunks') as HTMLInputElement | null;
  const vMaxChunks = document.getElementById('val-max-chunks') as HTMLElement | null;
  sMaxChunks?.addEventListener('input', () => updateSliderFill(sMaxChunks, vMaxChunks));

  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const get = (id: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return null;
      if (el.type === 'checkbox') return el.checked;
      if (el.type === 'number' || el.type === 'range') return Number(el.value);
      return el.value;
    };

    const newSettings = {
      interceptDownloads: Boolean(get('setting-intercept')),
      autoStart:          Boolean(get('setting-autostart')),
      maxConcurrent:      Math.max(1, Math.min(10, Math.round(Number(get('setting-max-concurrent')) || 3))),
      maxChunks:          Math.max(1, Math.min(16, Math.round(Number(get('setting-max-chunks')) || 8))),
      speedLimitKBps:     Math.max(0, Math.floor(Number(get('setting-speed-limit')) || 0)),
      verifyIntegrity:    Boolean(get('setting-verify-integrity')),
      showNotifications:  Boolean(get('setting-notifications')),
      maxHistoryItems:    Math.max(10, Math.min(9999, Math.floor(Number(get('setting-max-history')) || 500))),
    };

    const res = await sendMsg({ type: MSG.UPDATE_SETTINGS, payload: newSettings });
    if (res?.settings) {
      state.settings = res.settings;
      const qSlider = document.getElementById('q-max-concurrent') as HTMLInputElement | null;
      const qVal    = document.getElementById('q-max-val') as HTMLElement | null;
      if (qSlider) {
        qSlider.value = String(res.settings.maxConcurrent);
        updateSliderFill(qSlider, qVal);
      }
    }

    const $status = document.getElementById('save-status');
    if ($status) {
      $status.textContent = 'Settings Saved';
      $status.classList.add('visible');
      setTimeout(() => $status.classList.remove('visible'), 2500);
    }
  });

  document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
    if (!confirm('This will permanently clear all download history and reset lifetime stats. Are you sure?')) return;
    await sendMsg({ type: MSG.CLEAR_HISTORY });
    state.downloads = {};
    state.histCurrentPage = 1;
    onResetAll();

    const $status = document.getElementById('save-status');
    if ($status) {
      $status.textContent = 'All Data Reset';
      $status.classList.add('visible');
      setTimeout(() => $status.classList.remove('visible'), 2500);
    }
  });
}
