// ============================================================
//  All-Downloader — Settings UI View & Configuration Persistence
// ============================================================
import { DEFAULT_SETTINGS, MSG, CATEGORY_FOLDER_NAMES } from '../../../shared/constants.js';
import type { ExtensionSettings, RoutingRule } from '../../../shared/types.js';
import { RoutingEngine } from '../../../background/services/routing-engine.js';
import { resolveDownloadRoute } from '../../../background/services/smart-routing-resolver.js';
import { detectCategory } from '../../../shared/utils.js';
import { state } from '../state.js';
import { sendMsg } from '../api.js';
import { updateSliderFill } from '../dom-helpers.js';

export function loadSettingsUI(): void {
  const s = { ...DEFAULT_SETTINGS, ...state.settings };

  const setVal = (id: string, val: any) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    if (el === document.activeElement) return; // Do not overwrite input if user is actively typing
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
  setVal('setting-preserve-chunks',       s.preserveChunksOnCancel);
  setVal('setting-verify-integrity',     s.verifyIntegrity);
  setVal('setting-notifications',        s.showNotifications);
  setVal('setting-hide-shelf',           s.hideChromeShelf);
  setVal('setting-unblock-right-click',  s.unblockRightClick !== false);
  setVal('setting-enable-routing',       s.enableRoutingRules);
  setVal('setting-enable-smart-routing', s.enableSmartRouting !== false);
  setVal('setting-smart-structure',      s.smartRoutingStructure || 'contextual');
  setVal('setting-smart-clean-filename', s.smartFilenameClean !== false);
  setVal('setting-max-history',          Math.max(10, s.maxHistoryItems || DEFAULT_SETTINGS.maxHistoryItems));

  loadRoutingRulesUI(s.routingRules || []);
  updateStudioStatusUI();
  updateSimulatorPreview();

  const stratSelect = document.getElementById('setting-smart-structure') as HTMLSelectElement | null;
  if (stratSelect) {
    document.querySelectorAll('.strategy-chip').forEach(chip => {
      chip.classList.toggle('active', chip.getAttribute('data-strategy') === stratSelect.value);
    });
  }

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

    const rawHist = (document.getElementById('setting-max-history') as HTMLInputElement)?.value.trim();
    let maxHistoryItems: number = DEFAULT_SETTINGS.maxHistoryItems;
    if (rawHist !== '' && rawHist !== undefined) {
      const parsed = parseInt(rawHist, 10);
      maxHistoryItems = isNaN(parsed)
        ? (state.settings?.maxHistoryItems || DEFAULT_SETTINGS.maxHistoryItems)
        : Math.max(10, Math.min(99999, parsed));
    } else if (state.settings?.maxHistoryItems) {
      maxHistoryItems = Math.max(10, state.settings.maxHistoryItems);
    }

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
      organizeByCategoryFolders: ((document.getElementById('setting-smart-structure') as HTMLSelectElement)?.value || state.settings?.smartRoutingStructure) === 'category' || ((document.getElementById('setting-smart-structure') as HTMLSelectElement)?.value || state.settings?.smartRoutingStructure) === 'contextual',
      preserveChunksOnCancel:    Boolean(get('setting-preserve-chunks') ?? (state.settings?.preserveChunksOnCancel ?? DEFAULT_SETTINGS.preserveChunksOnCancel)),
      verifyIntegrity:           Boolean(get('setting-verify-integrity') ?? (state.settings?.verifyIntegrity ?? DEFAULT_SETTINGS.verifyIntegrity)),
      showNotifications:         Boolean(get('setting-notifications') ?? (state.settings?.showNotifications ?? DEFAULT_SETTINGS.showNotifications)),
      hideChromeShelf:           Boolean(get('setting-hide-shelf') ?? (state.settings?.hideChromeShelf ?? DEFAULT_SETTINGS.hideChromeShelf)),
      autoCheckUpdates:          Boolean(state.settings?.autoCheckUpdates ?? DEFAULT_SETTINGS.autoCheckUpdates),
      maxHistoryItems,
      darkMode:                  Boolean(state.settings?.darkMode ?? DEFAULT_SETTINGS.darkMode),
      enableRoutingRules:        Boolean(get('setting-enable-routing') ?? (state.settings?.enableRoutingRules ?? DEFAULT_SETTINGS.enableRoutingRules)),
      routingRules:              getRoutingRules(),
      unblockRightClick:         Boolean(get('setting-unblock-right-click') ?? (state.settings?.unblockRightClick ?? DEFAULT_SETTINGS.unblockRightClick)),
      enableSmartRouting:        Boolean(get('setting-enable-smart-routing') ?? (state.settings?.enableSmartRouting ?? DEFAULT_SETTINGS.enableSmartRouting)),
      smartRoutingStructure:     (document.getElementById('setting-smart-structure') as HTMLSelectElement)?.value as any || 'contextual',
      smartFilenameClean:        Boolean(get('setting-smart-clean-filename') ?? (state.settings?.smartFilenameClean ?? DEFAULT_SETTINGS.smartFilenameClean)),
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
      const elMaxHist = document.getElementById('setting-max-history') as HTMLInputElement | null;
      if (elMaxHist && elMaxHist !== document.activeElement) {
        elMaxHist.value = String(res.settings.maxHistoryItems);
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

  // Auto-save on toggle switches and dropdowns immediately on change
  [
    'setting-intercept',
    'setting-autostart',
    'setting-preserve-chunks',
    'setting-verify-integrity',
    'setting-notifications',
    'setting-hide-shelf',
    'setting-unblock-right-click',
    'setting-enable-routing',
    'setting-enable-smart-routing',
    'setting-smart-structure',
    'setting-smart-clean-filename',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (id === 'setting-enable-routing' || id === 'setting-enable-smart-routing') {
        updateStudioStatusUI();
      }
      updateSimulatorPreview();
      saveAllSettings(true);
    });
  });

  // Simulator live preview bindings
  document.getElementById('sim-url')?.addEventListener('input', () => {
    updateSimulatorPreview();
  });
  document.getElementById('sim-title')?.addEventListener('input', () => {
    updateSimulatorPreview();
  });

  // Auto-save on sliders after pointer release or keyboard change
  ['setting-max-concurrent', 'setting-max-chunks'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      clearTimeout(debounceSettingsTimer);
      saveAllSettings(true);
    });
  });

  // Auto-save on input with debounce & on change/blur/Enter for text & other inputs
  [
    'setting-min-chunk-size',
    'setting-speed-limit',
    'setting-save-path',
  ].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => {
      if (id === 'setting-save-path') updateSimulatorPreview();
      debouncedAutoSave(500);
    });
    el?.addEventListener('change', () => {
      clearTimeout(debounceSettingsTimer);
      if (id === 'setting-save-path') updateSimulatorPreview();
      saveAllSettings(true);
    });
    el?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        clearTimeout(debounceSettingsTimer);
        saveAllSettings(true);
      }
    });
  });

  // Dedicated handling for setting-max-history:
  // User can edit digits freely without input hijacking. Clamps to minimum 10 upon finish.
  const elMaxHist = document.getElementById('setting-max-history') as HTMLInputElement | null;
  elMaxHist?.addEventListener('change', () => {
    clearTimeout(debounceSettingsTimer);
    const raw = elMaxHist.value.trim();
    if (raw === '') {
      elMaxHist.value = '10';
    } else {
      const parsed = parseInt(raw, 10);
      elMaxHist.value = String(isNaN(parsed) || parsed < 10 ? 10 : Math.min(99999, parsed));
    }
    saveAllSettings(true);
  });
  elMaxHist?.addEventListener('blur', () => {
    const raw = elMaxHist.value.trim();
    if (raw === '') {
      elMaxHist.value = '10';
      saveAllSettings(true);
    } else {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed < 10) {
        elMaxHist.value = '10';
        saveAllSettings(true);
      }
    }
  });
  elMaxHist?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      clearTimeout(debounceSettingsTimer);
      const raw = elMaxHist.value.trim();
      const parsed = parseInt(raw, 10);
      elMaxHist.value = String(isNaN(parsed) || parsed < 10 ? 10 : Math.min(99999, parsed));
      saveAllSettings(true);
    }
  });

  bindRoutingRules(debouncedAutoSave);
  bindRoutingStudioTabs();

  document.getElementById('btn-save-settings')?.addEventListener('click', () => saveAllSettings(false));

  document.getElementById('btn-clean-chunks')?.addEventListener('click', async () => {
    const $btn = document.getElementById('btn-clean-chunks') as HTMLButtonElement | null;
    if ($btn) $btn.disabled = true;
    try {
      const res = await sendMsg({ type: MSG.CLEAN_CHUNK_CACHE });
      const $status = document.getElementById('save-status');
      if ($status) {
        const count = res?.cleanedCount ?? 0;
        $status.textContent = count > 0 ? `Cleaned ${count} cached chunk(s)` : 'Cache is already clean';
        $status.classList.remove('error');
        $status.classList.add('visible');
        setTimeout(() => $status.classList.remove('visible'), 2500);
      }
    } finally {
      if ($btn) $btn.disabled = false;
    }
  });

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

// ============================================================
//  Smart Directory Routing Rules — In-Memory UI Manager
// ============================================================

let currentRules: RoutingRule[] = [];
let notifyAutoSave: ((delayMs?: number) => void) | null = null;
let lastActiveRuleInput: HTMLInputElement | null = null;

export const ROUTING_PRESETS: Record<string, Omit<RoutingRule, 'id' | 'priority'>> = {
  github: {
    name: 'GitHub Releases',
    enabled: true,
    action: 'route_to',
    conditions: [
      { field: 'domain', op: 'equals', value: 'github.com' },
      { field: 'category', op: 'equals', value: 'archive' },
    ],
    savePath: 'Code/{domain}/{date}',
    filenameTemplate: '',
  },
  design: {
    name: 'Design Assets',
    enabled: true,
    action: 'both',
    conditions: [
      { field: 'domain', op: 'in', value: 'unsplash.com, figma.com, dribbble.com, pexels.com' },
    ],
    savePath: 'Design/{site}/{date}',
    filenameTemplate: '{site}_{date}_{original_name}.{ext}',
  },
  pdf: {
    name: 'Research PDFs',
    enabled: true,
    action: 'route_to',
    conditions: [
      { field: 'ext', op: 'equals', value: 'pdf' },
    ],
    savePath: 'Documents/Research/{year}/{quarter}',
    filenameTemplate: '',
  },
  video: {
    name: 'Video Downloads',
    enabled: true,
    action: 'route_to',
    conditions: [
      { field: 'category', op: 'equals', value: 'video' },
    ],
    savePath: 'Videos/{site}/{year}',
    filenameTemplate: '',
  },
  learning: {
    name: 'Course Lectures',
    enabled: true,
    action: 'both',
    conditions: [
      { field: 'url_pattern', op: 'regex', value: 'lecture|course|tutorial|module' },
    ],
    savePath: 'Learning/{site}',
    filenameTemplate: '{title}_{original_name}.{ext}',
  },
};

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'rule_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function loadRoutingRulesUI(rules: RoutingRule[]): void {
  const container = document.getElementById('routing-rules-list');
  // If the user is currently editing inside routing rules, do not blow away their input!
  if (container && container.contains(document.activeElement)) {
    return;
  }
  currentRules = [...(rules || [])].sort((a, b) => a.priority - b.priority);
  renderRoutingRules();
}

export function getRoutingRules(): RoutingRule[] {
  return currentRules;
}

export function updateRoutingStatusBadge(isEnabled?: boolean): void {
  updateStudioStatusUI();
}

export function updateStudioStatusUI(): void {
  const smartChk = document.getElementById('setting-enable-smart-routing') as HTMLInputElement | null;
  const rulesChk = document.getElementById('setting-enable-routing') as HTMLInputElement | null;

  const isSmartRoutingOn = smartChk ? smartChk.checked : true;
  const isCustomRulesOn  = rulesChk ? rulesChk.checked : false;

  // 1. Update Master Header Badge
  const badge = document.getElementById('routing-status-indicator');
  if (badge) {
    if (isSmartRoutingOn && isCustomRulesOn) {
      badge.textContent = 'Active (Custom Rules + Auto-Organizer)';
      badge.className = 'routing-status-badge active';
    } else if (isSmartRoutingOn && !isCustomRulesOn) {
      badge.textContent = 'Auto-Organizer Active';
      badge.className = 'routing-status-badge auto-only';
    } else if (!isSmartRoutingOn && isCustomRulesOn) {
      badge.textContent = 'Custom Rules Only (Auto-Organizer Off)';
      badge.className = 'routing-status-badge custom-only';
    } else {
      badge.textContent = 'Off (Direct to Base Folder)';
      badge.className = 'routing-status-badge inactive';
    }
  }

  // 2. Tab 1 (Smart Auto-Organizer) Indicator & Pane State
  const tabOrganizerSub = document.querySelector('#tab-routing-organizer .tab-sub');
  if (tabOrganizerSub) {
    tabOrganizerSub.textContent = isSmartRoutingOn ? 'Automated Sorting' : 'Paused (Off)';
    tabOrganizerSub.classList.toggle('text-off', !isSmartRoutingOn);
  }

  const pausedBanner = document.getElementById('organizer-paused-banner');
  if (pausedBanner) {
    pausedBanner.style.display = isSmartRoutingOn ? 'none' : 'flex';
  }

  const organizerControlsWrap = document.getElementById('organizer-controls-wrap');
  if (organizerControlsWrap) {
    organizerControlsWrap.classList.toggle('controls-dimmed', !isSmartRoutingOn);
  }

  // 3. Tab 2 (Custom Override Rules) Indicator & Banner State
  const activeCount = currentRules.filter(r => r.enabled).length;
  const tabRulesSub = document.querySelector('#tab-routing-rules .tab-sub');
  const countBadge = document.getElementById('rules-count-badge');
  const rulesStatusText = isCustomRulesOn
    ? `${activeCount} Active ${activeCount === 1 ? 'Rule' : 'Rules'}`
    : 'Paused (Off)';

  if (tabRulesSub) {
    tabRulesSub.textContent = rulesStatusText;
    tabRulesSub.classList.toggle('text-off', !isCustomRulesOn);
  }
  if (countBadge) {
    countBadge.textContent = rulesStatusText;
    countBadge.classList.toggle('badge-off', !isCustomRulesOn);
  }

  const rulesBannerRow = document.getElementById('rules-banner-row');
  const rulesBannerIcon = document.getElementById('rules-banner-icon');
  const rulesBannerTitle = document.getElementById('rules-banner-title');
  const rulesBannerDesc = document.getElementById('rules-banner-desc');

  if (rulesBannerRow) {
    rulesBannerRow.classList.toggle('rules-banner-paused', !isCustomRulesOn);
  }
  if (rulesBannerIcon) {
    rulesBannerIcon.textContent = isCustomRulesOn ? '⚡' : '⏸️';
  }
  if (rulesBannerTitle) {
    rulesBannerTitle.textContent = isCustomRulesOn ? 'First-Priority Execution' : 'Custom Override Rules are Paused';
  }
  if (rulesBannerDesc) {
    rulesBannerDesc.textContent = isCustomRulesOn
      ? 'Custom rules evaluate before the Auto-Organizer. The first matching rule sets the folder and filename format.'
      : 'User rules are currently turned off. All downloads will follow the Auto-Organizer.';
  }

  // 4. Update whole studio card class if both off
  const studioCard = document.getElementById('smart-semantic-routing-group');
  if (studioCard) {
    studioCard.classList.toggle('studio-all-paused', !isSmartRoutingOn && !isCustomRulesOn);
  }
}

function getRulePreviewPath(rule: RoutingRule): string {
  const dummyCtx: Record<string, string> = {
    domain: 'github.com',
    site: 'github',
    subdomain: 'api',
    date: '2026-10-25',
    year: '2026',
    month: '10',
    quarter: 'Q4',
    timestamp: '1729864200',
    category: 'code',
    ext: 'zip',
    original_name: 'v1.0.0-release',
    title: 'Release_v1.0.0',
  };

  const expand = (tmpl: string) => {
    return (tmpl || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => dummyCtx[key] || match);
  };

  let subfolder = '';
  if (rule.action !== 'rename' && rule.savePath && rule.savePath.trim()) {
    subfolder = expand(rule.savePath.trim()).replace(/\\/g, '/');
    if (!subfolder.endsWith('/')) subfolder += '/';
  }

  let filename = '';
  if (rule.action !== 'route_to' && rule.filenameTemplate && rule.filenameTemplate.trim()) {
    filename = expand(rule.filenameTemplate.trim());
    if (!filename.includes('.')) filename += '.zip';
  } else {
    filename = 'v1.0.0-release.zip';
  }

  return escapeHtml(`${subfolder}${filename}`);
}

function renderRoutingRules(): void {
  const container = document.getElementById('routing-rules-list');
  if (!container) return;

  updateStudioStatusUI();
  updateSimulatorPreview();

  if (currentRules.length === 0) {
    container.innerHTML = `
      <div class="routing-empty-state compact">
        <div class="empty-state-top">
          <div class="empty-state-icon-wrap">⚡</div>
          <div class="empty-state-text">
            <h4 class="empty-state-title">No Custom Rules Configured</h4>
            <p class="empty-state-desc">
              All downloads currently follow the <strong>Smart Auto-Organizer</strong>. Add a custom rule or select a starter preset below to route specific websites or formats into custom folders:
            </p>
          </div>
        </div>
        <div class="empty-state-quick-presets">
          <span class="quick-presets-label">Click a starter rule to add immediately:</span>
          <div class="quick-presets-chips">
            <button type="button" class="btn-empty-preset" data-preset="github">💻 GitHub Releases</button>
            <button type="button" class="btn-empty-preset" data-preset="design">🎨 Design Assets</button>
            <button type="button" class="btn-empty-preset" data-preset="pdf">📄 Research PDFs</button>
            <button type="button" class="btn-empty-preset" data-preset="video">🎬 Video Downloads</button>
            <button type="button" class="btn-empty-preset" data-preset="learning">🎓 Course Lectures</button>
          </div>
        </div>
      </div>
    `;

    attachRuleCardListeners();
    return;
  }

  container.innerHTML = currentRules
    .map((rule, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === currentRules.length - 1;
      const disabledClass = rule.enabled ? '' : ' rule-disabled';

      const conditionsHtml = (rule.conditions || [])
        .map((cond, cIdx) => `
          <div class="condition-row" data-cond-idx="${cIdx}">
            <span class="cond-badge ${cIdx === 0 ? 'if' : 'and'}">${cIdx === 0 ? 'IF' : 'AND'}</span>
            <select class="rule-select cond-field" data-rule-id="${rule.id}" data-cond-idx="${cIdx}">
              <option value="domain" ${cond.field === 'domain' ? 'selected' : ''}>Website Domain</option>
              <option value="category" ${cond.field === 'category' ? 'selected' : ''}>File Category</option>
              <option value="ext" ${cond.field === 'ext' ? 'selected' : ''}>File Extension</option>
              <option value="filename" ${cond.field === 'filename' ? 'selected' : ''}>Filename</option>
              <option value="url_pattern" ${cond.field === 'url_pattern' ? 'selected' : ''}>URL Pattern</option>
              <option value="title" ${cond.field === 'title' ? 'selected' : ''}>Page Title</option>
              <option value="mime" ${cond.field === 'mime' ? 'selected' : ''}>MIME Content Type</option>
            </select>
            <select class="rule-select cond-op" data-rule-id="${rule.id}" data-cond-idx="${cIdx}">
              <option value="equals" ${cond.op === 'equals' ? 'selected' : ''}>equals</option>
              <option value="not_equals" ${cond.op === 'not_equals' ? 'selected' : ''}>does not equal</option>
              <option value="contains" ${cond.op === 'contains' ? 'selected' : ''}>contains</option>
              <option value="not_contains" ${cond.op === 'not_contains' ? 'selected' : ''}>does not contain</option>
              <option value="starts_with" ${cond.op === 'starts_with' ? 'selected' : ''}>starts with</option>
              <option value="ends_with" ${cond.op === 'ends_with' ? 'selected' : ''}>ends with</option>
              <option value="in" ${cond.op === 'in' ? 'selected' : ''}>is in (comma-separated)</option>
              <option value="not_in" ${cond.op === 'not_in' ? 'selected' : ''}>is not in (comma-separated)</option>
              <option value="regex" ${cond.op === 'regex' ? 'selected' : ''}>regex matches</option>
            </select>
            <input type="text" class="rule-input-text cond-val" data-rule-id="${rule.id}" data-cond-idx="${cIdx}" value="${escapeHtml(cond.value)}" placeholder="e.g. github.com, pdf" />
            ${(rule.conditions || []).length > 1 ? `
              <button type="button" class="btn-icon-sm btn-icon-delete" data-del-cond-rule="${rule.id}" data-del-cond-idx="${cIdx}" title="Remove Condition">✕</button>
            ` : ''}
          </div>
        `)
        .join('');

      return `
        <div class="rule-card${disabledClass}" data-rule-id="${rule.id}">
          <div class="rule-card-header">
            <div class="rule-card-title-wrap">
              <span class="rule-priority-pill">RULE #${idx + 1}</span>
              <input type="text" class="rule-name-input" data-rule-id="${rule.id}" value="${escapeHtml(rule.name)}" placeholder="Rule Name" />
            </div>
            <div class="rule-card-controls">
              <button type="button" class="btn-icon-sm" data-move-up="${rule.id}" title="Move Up (Higher Priority)" ${isFirst ? 'disabled' : ''}>▲</button>
              <button type="button" class="btn-icon-sm" data-move-down="${rule.id}" title="Move Down" ${isLast ? 'disabled' : ''}>▼</button>
              <button type="button" class="btn-icon-sm" data-clone-rule="${rule.id}" title="Duplicate Rule">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
              <label class="toggle" title="Enable or Disable Rule">
                <input type="checkbox" class="rule-toggle-enable" data-rule-id="${rule.id}" ${rule.enabled ? 'checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
              <button type="button" class="btn-icon-sm btn-icon-delete" data-del-rule="${rule.id}" title="Delete Rule">✕</button>
            </div>
          </div>

          <!-- SECTION 1: IF CONDITIONS -->
          <div class="rule-section">
            <div class="rule-section-header">
              <span class="section-tag if-tag">IF</span>
              <span class="section-tag-label">When incoming download matches ALL conditions below:</span>
            </div>
            <div class="rule-conditions-block">
              ${conditionsHtml}
              <div>
                <button type="button" class="btn-ghost-sm" data-add-cond-rule="${rule.id}">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  <span>Add Condition (AND)</span>
                </button>
              </div>
            </div>
          </div>

          <!-- SECTION 2: THEN ACTION -->
          <div class="rule-section">
            <div class="rule-section-header">
              <span class="section-tag then-tag">THEN</span>
              <span class="section-tag-label">Apply custom directory path or filename format:</span>
            </div>
            <div class="rule-action-block">
              <div class="rule-action-tabs">
                <button type="button" class="action-tab-btn ${rule.action === 'route_to' ? 'active' : ''}" data-action="route_to" data-rule-id="${rule.id}">📁 Route to Subfolder</button>
                <button type="button" class="action-tab-btn ${rule.action === 'rename' ? 'active' : ''}" data-action="rename" data-rule-id="${rule.id}">🏷️ Rename File</button>
                <button type="button" class="action-tab-btn ${rule.action === 'both' ? 'active' : ''}" data-action="both" data-rule-id="${rule.id}">⚡ Subfolder &amp; Rename</button>
              </div>

              ${rule.action !== 'rename' ? `
                <div class="rule-field-group">
                  <div class="field-label-row">
                    <span class="rule-field-label">Target Subfolder Path:</span>
                    <div class="quick-tokens-insert">
                      <span class="quick-insert-label">Quick Tokens:</span>
                      <button type="button" class="quick-token-btn" data-rule-id="${rule.id}" data-target-field="savePath" data-token="{domain}">{domain}</button>
                      <button type="button" class="quick-token-btn" data-rule-id="${rule.id}" data-target-field="savePath" data-token="{site}">{site}</button>
                      <button type="button" class="quick-token-btn" data-rule-id="${rule.id}" data-target-field="savePath" data-token="{date}">{date}</button>
                      <button type="button" class="quick-token-btn" data-rule-id="${rule.id}" data-target-field="savePath" data-token="{year}">{year}</button>
                    </div>
                  </div>
                  <input type="text" class="rule-input-text rule-save-path" data-rule-id="${rule.id}" value="${escapeHtml(rule.savePath || '')}" placeholder="e.g. Code/{domain}/{date}" />
                </div>
              ` : ''}

              ${rule.action !== 'route_to' ? `
                <div class="rule-field-group">
                  <div class="field-label-row">
                    <span class="rule-field-label">Custom Filename Template:</span>
                    <div class="quick-tokens-insert">
                      <span class="quick-insert-label">Quick Tokens:</span>
                      <button type="button" class="quick-token-btn" data-rule-id="${rule.id}" data-target-field="filenameTemplate" data-token="{original_name}">{original_name}</button>
                      <button type="button" class="quick-token-btn" data-rule-id="${rule.id}" data-target-field="filenameTemplate" data-token="{date}">{date}</button>
                      <button type="button" class="quick-token-btn" data-rule-id="${rule.id}" data-target-field="filenameTemplate" data-token="{ext}">.{ext}</button>
                    </div>
                  </div>
                  <input type="text" class="rule-input-text rule-filename-template" data-rule-id="${rule.id}" value="${escapeHtml(rule.filenameTemplate || '')}" placeholder="e.g. {site}_{date}_{original_name}.{ext}" />
                </div>
              ` : ''}

              <!-- Live Preview -->
              <div class="rule-live-preview-box">
                <span class="preview-box-icon">⚡</span>
                <span class="preview-box-title">Live Preview:</span>
                <span class="preview-box-result" data-rule-preview="${rule.id}">Downloads / ${getRulePreviewPath(rule)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  attachRuleCardListeners();
}

function attachRuleCardListeners(): void {
  const container = document.getElementById('routing-rules-list');
  if (!container) return;

  // Handle empty state quick presets click
  container.querySelectorAll('.btn-empty-preset').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const presetKey = (e.currentTarget as HTMLElement).getAttribute('data-preset');
      if (presetKey) applyPreset(presetKey);
    });
  });

  // Track focused text inputs for token chip insertion
  container.querySelectorAll('input[type="text"]').forEach((input) => {
    input.addEventListener('focus', () => {
      lastActiveRuleInput = input as HTMLInputElement;
    });
  });

  // Live preview update helper
  const updateRulePreview = (ruleId: string) => {
    const rule = currentRules.find(r => r.id === ruleId);
    if (!rule) return;
    const previewEl = container.querySelector(`[data-rule-preview="${ruleId}"]`);
    if (previewEl) {
      previewEl.innerHTML = `Downloads / ${getRulePreviewPath(rule)}`;
    }
  };

  // Rule Name
  container.querySelectorAll('.rule-name-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-rule-id');
      const rule = currentRules.find(r => r.id === id);
      if (rule) {
        rule.name = (e.target as HTMLInputElement).value;
        notifyAutoSave?.(400);
      }
    });
  });

  // Enable Toggle
  container.querySelectorAll('.rule-toggle-enable').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-rule-id');
      const rule = currentRules.find(r => r.id === id);
      if (rule) {
        rule.enabled = (e.target as HTMLInputElement).checked;
        const card = container.querySelector(`.rule-card[data-rule-id="${id}"]`);
        if (card) {
          card.classList.toggle('rule-disabled', !rule.enabled);
        }
        updateStudioStatusUI();
        updateSimulatorPreview();
        notifyAutoSave?.(100);
      }
    });
  });

  // Move Up
  container.querySelectorAll('[data-move-up]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-move-up');
      const idx = currentRules.findIndex(r => r.id === id);
      if (idx > 0) {
        const temp = currentRules[idx];
        currentRules[idx] = currentRules[idx - 1];
        currentRules[idx - 1] = temp;
        currentRules.forEach((r, i) => { r.priority = i + 1; });
        renderRoutingRules();
        notifyAutoSave?.(100);
      }
    });
  });

  // Move Down
  container.querySelectorAll('[data-move-down]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-move-down');
      const idx = currentRules.findIndex(r => r.id === id);
      if (idx >= 0 && idx < currentRules.length - 1) {
        const temp = currentRules[idx];
        currentRules[idx] = currentRules[idx + 1];
        currentRules[idx + 1] = temp;
        currentRules.forEach((r, i) => { r.priority = i + 1; });
        renderRoutingRules();
        notifyAutoSave?.(100);
      }
    });
  });

  // Clone / Duplicate Rule
  container.querySelectorAll('[data-clone-rule]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-clone-rule');
      const rule = currentRules.find(r => r.id === id);
      if (rule) {
        const cloned: RoutingRule = {
          ...JSON.parse(JSON.stringify(rule)),
          id: generateId(),
          name: `${rule.name} (Copy)`,
          priority: currentRules.length + 1,
        };
        currentRules.push(cloned);
        renderRoutingRules();
        notifyAutoSave?.(100);
      }
    });
  });

  // Delete Rule
  container.querySelectorAll('[data-del-rule]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-del-rule');
      currentRules = currentRules.filter(r => r.id !== id);
      currentRules.forEach((r, i) => { r.priority = i + 1; });
      renderRoutingRules();
      notifyAutoSave?.(100);
    });
  });

  // Regex Live Validator helper
  const validateRegexInput = (input: HTMLInputElement) => {
    const row = input.closest('.condition-row');
    const op = (row?.querySelector('.cond-op') as HTMLSelectElement)?.value;
    if (op === 'regex' && input.value.trim()) {
      try {
        new RegExp(input.value.trim());
        input.classList.remove('input-regex-invalid');
        input.removeAttribute('title');
      } catch (err: any) {
        input.classList.add('input-regex-invalid');
        input.setAttribute('title', `Invalid RegExp: ${err.message}`);
      }
    } else {
      input.classList.remove('input-regex-invalid');
      input.removeAttribute('title');
    }
  };

  // Condition Field
  container.querySelectorAll('.cond-field').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-rule-id');
      const cIdx = parseInt((e.target as HTMLElement).getAttribute('data-cond-idx') || '0', 10);
      const rule = currentRules.find(r => r.id === id);
      if (rule && rule.conditions[cIdx]) {
        rule.conditions[cIdx].field = (e.target as HTMLSelectElement).value as any;
        notifyAutoSave?.(200);
      }
    });
  });

  // Condition Op
  container.querySelectorAll('.cond-op').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-rule-id');
      const cIdx = parseInt((e.target as HTMLElement).getAttribute('data-cond-idx') || '0', 10);
      const rule = currentRules.find(r => r.id === id);
      if (rule && rule.conditions[cIdx]) {
        rule.conditions[cIdx].op = (e.target as HTMLSelectElement).value as any;
        const row = (e.target as HTMLElement).closest('.condition-row');
        const valInput = row?.querySelector('.cond-val') as HTMLInputElement | null;
        if (valInput) validateRegexInput(valInput);
        notifyAutoSave?.(200);
      }
    });
  });

  // Condition Value
  container.querySelectorAll('.cond-val').forEach((input) => {
    const el = input as HTMLInputElement;
    validateRegexInput(el);

    el.addEventListener('input', (e) => {
      const targetInput = e.target as HTMLInputElement;
      validateRegexInput(targetInput);
      const id = targetInput.getAttribute('data-rule-id');
      const cIdx = parseInt(targetInput.getAttribute('data-cond-idx') || '0', 10);
      const rule = currentRules.find(r => r.id === id);
      if (rule && rule.conditions[cIdx]) {
        rule.conditions[cIdx].value = targetInput.value;
        notifyAutoSave?.(400);
      }
    });
  });

  // Add Condition
  container.querySelectorAll('[data-add-cond-rule]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-add-cond-rule');
      const rule = currentRules.find(r => r.id === id);
      if (rule) {
        rule.conditions.push({ field: 'domain', op: 'equals', value: '' });
        renderRoutingRules();
        notifyAutoSave?.(100);
      }
    });
  });

  // Delete Condition
  container.querySelectorAll('[data-del-cond-rule]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).getAttribute('data-del-cond-rule');
      const cIdx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-del-cond-idx') || '0', 10);
      const rule = currentRules.find(r => r.id === id);
      if (rule && rule.conditions.length > 1) {
        rule.conditions.splice(cIdx, 1);
        renderRoutingRules();
        notifyAutoSave?.(100);
      }
    });
  });

  // Action Tabs (Segmented Control)
  container.querySelectorAll('.action-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const targetBtn = e.currentTarget as HTMLElement;
      const id = targetBtn.getAttribute('data-rule-id');
      const action = targetBtn.getAttribute('data-action') as any;
      const rule = currentRules.find(r => r.id === id);
      if (rule && action && rule.action !== action) {
        rule.action = action;
        renderRoutingRules();
        notifyAutoSave?.(100);
      }
    });
  });

  // Quick Token Insert Buttons
  container.querySelectorAll('.quick-token-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetBtn = e.currentTarget as HTMLElement;
      const id = targetBtn.getAttribute('data-rule-id');
      const field = targetBtn.getAttribute('data-target-field');
      const token = targetBtn.getAttribute('data-token');
      if (!id || !field || !token) return;

      const rule = currentRules.find(r => r.id === id);
      if (!rule) return;

      const card = container.querySelector(`.rule-card[data-rule-id="${id}"]`);
      const input = card?.querySelector(field === 'savePath' ? '.rule-save-path' : '.rule-filename-template') as HTMLInputElement | null;
      if (input) {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        const val = input.value;
        input.value = val.slice(0, start) + token + val.slice(end);
        input.selectionStart = input.selectionEnd = start + token.length;
        if (field === 'savePath') rule.savePath = input.value;
        if (field === 'filenameTemplate') rule.filenameTemplate = input.value;
        updateRulePreview(id);
        notifyAutoSave?.(200);
        input.focus();
      }
    });
  });

  // Save Path
  container.querySelectorAll('.rule-save-path').forEach((input) => {
    input.addEventListener('input', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-rule-id');
      const rule = currentRules.find(r => r.id === id);
      if (rule && id) {
        rule.savePath = (e.target as HTMLInputElement).value;
        updateRulePreview(id);
        notifyAutoSave?.(300);
      }
    });
  });

  // Filename Template
  container.querySelectorAll('.rule-filename-template').forEach((input) => {
    input.addEventListener('input', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-rule-id');
      const rule = currentRules.find(r => r.id === id);
      if (rule && id) {
        rule.filenameTemplate = (e.target as HTMLInputElement).value;
        updateRulePreview(id);
        notifyAutoSave?.(300);
      }
    });
  });
}

export function switchToRulesTab(): void {
  const tabBtn = document.getElementById('tab-routing-rules') as HTMLElement | null;
  if (tabBtn && !tabBtn.classList.contains('active')) {
    tabBtn.click();
  }
}

export function applyPreset(presetKey: string): void {
  if (presetKey && ROUTING_PRESETS[presetKey]) {
    const preset = ROUTING_PRESETS[presetKey];
    const newRule: RoutingRule = {
      id: generateId(),
      priority: currentRules.length + 1,
      name: preset.name,
      enabled: preset.enabled,
      action: preset.action,
      conditions: JSON.parse(JSON.stringify(preset.conditions)),
      savePath: preset.savePath,
      filenameTemplate: preset.filenameTemplate,
    };
    currentRules.push(newRule);
    const presetsMenu = document.getElementById('presets-menu');
    if (presetsMenu) presetsMenu.style.display = 'none';
    renderRoutingRules();
    notifyAutoSave?.(100);
    switchToRulesTab();
  }
}

function bindRoutingStudioTabs(): void {
  const tabs = document.querySelectorAll('.routing-tab-btn');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabKey = btn.getAttribute('data-tab');
      tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      document.querySelectorAll('.routing-tab-pane').forEach(p => {
        (p as HTMLElement).style.display = 'none';
        p.classList.remove('active');
      });

      const pane = document.getElementById(`pane-routing-${tabKey}`);
      if (pane) {
        pane.style.display = 'block';
        pane.classList.add('active');
      }

      if (tabKey === 'simulator') {
        updateSimulatorPreview();
      }
    });
  });

  // Strategy chips sync
  const strategySelect = document.getElementById('setting-smart-structure') as HTMLSelectElement | null;
  const syncStrategyChips = (val: string) => {
    document.querySelectorAll('.strategy-chip').forEach(chip => {
      chip.classList.toggle('active', chip.getAttribute('data-strategy') === val);
    });
  };

  if (strategySelect) {
    syncStrategyChips(strategySelect.value);
    strategySelect.addEventListener('change', () => {
      syncStrategyChips(strategySelect.value);
    });
  }

  document.querySelectorAll('.strategy-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.getAttribute('data-strategy');
      if (val && strategySelect && strategySelect.value !== val) {
        strategySelect.value = val;
        syncStrategyChips(val);
        strategySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });

  // Quick enable button in paused banner
  document.getElementById('btn-quick-enable-organizer')?.addEventListener('click', () => {
    const chk = document.getElementById('setting-enable-smart-routing') as HTMLInputElement | null;
    if (chk && !chk.checked) {
      chk.checked = true;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

function bindRoutingRules(autoSave: (delayMs?: number) => void): void {
  notifyAutoSave = autoSave;

  // Add Rule Button
  document.getElementById('btn-add-routing-rule')?.addEventListener('click', () => {
    const newRule: RoutingRule = {
      id: generateId(),
      name: `Rule #${currentRules.length + 1}`,
      enabled: true,
      priority: currentRules.length + 1,
      conditions: [{ field: 'domain', op: 'equals', value: '' }],
      action: 'route_to',
      savePath: 'Downloads/{domain}',
      filenameTemplate: '',
    };
    currentRules.push(newRule);
    renderRoutingRules();
    notifyAutoSave?.(100);
    switchToRulesTab();

    // Focus the new rule's condition input
    setTimeout(() => {
      const container = document.getElementById('routing-rules-list');
      const lastInput = container?.querySelector(`.rule-card[data-rule-id="${newRule.id}"] .cond-val`) as HTMLInputElement | null;
      lastInput?.focus();
    }, 50);
  });

  // Preset Templates Dropdown Toggle
  const presetsBtn = document.getElementById('btn-routing-presets');
  const presetsMenu = document.getElementById('presets-menu');

  presetsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (presetsMenu) {
      presetsMenu.style.display = presetsMenu.style.display === 'none' ? 'flex' : 'none';
    }
  });

  document.addEventListener('click', () => {
    if (presetsMenu) {
      presetsMenu.style.display = 'none';
    }
  });

  // Preset Template Items in Dropdown
  document.querySelectorAll('.preset-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const presetKey = (e.currentTarget as HTMLElement).getAttribute('data-preset');
      if (presetKey) {
        applyPreset(presetKey);
      }
    });
  });

  // Toggle Tokens Reference Drawer
  const tokenDrawerBtn = document.getElementById('btn-toggle-tokens-cheatsheet');
  const tokenDrawer = document.getElementById('tokens-cheatsheet-drawer');
  tokenDrawerBtn?.addEventListener('click', () => {
    if (tokenDrawer) {
      const isOpen = tokenDrawer.style.display !== 'none';
      tokenDrawer.style.display = isOpen ? 'none' : 'block';
      tokenDrawerBtn.classList.toggle('active', !isOpen);
    }
  });

  // Token Chip Click (Inserts into active input or copies to clipboard)
  document.querySelectorAll('.token-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const token = chip.getAttribute('data-token') || chip.querySelector('code')?.textContent?.trim() || chip.textContent?.trim();
      if (!token) return;

      if (lastActiveRuleInput && document.body.contains(lastActiveRuleInput)) {
        const start = lastActiveRuleInput.selectionStart ?? lastActiveRuleInput.value.length;
        const end = lastActiveRuleInput.selectionEnd ?? lastActiveRuleInput.value.length;
        const val = lastActiveRuleInput.value;
        lastActiveRuleInput.value = val.slice(0, start) + token + val.slice(end);
        lastActiveRuleInput.selectionStart = lastActiveRuleInput.selectionEnd = start + token.length;
        lastActiveRuleInput.dispatchEvent(new Event('input', { bubbles: true }));
        lastActiveRuleInput.focus();
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(token).catch(() => {});
        const sub = chip.querySelector('.token-sub');
        if (sub) {
          const orig = sub.textContent;
          sub.textContent = 'Copied!';
          setTimeout(() => { sub.textContent = orig; }, 1000);
        }
      }
    });
  });
}

// ── Live Smart Routing Simulator ──────────────────────────────

export function updateSimulatorPreview(): void {
  const simUrlInput = document.getElementById('sim-url') as HTMLInputElement | null;
  const simTitleInput = document.getElementById('sim-title') as HTMLInputElement | null;
  const card = document.getElementById('sim-result-card') as HTMLElement | null;
  if (!card) return;

  const url = simUrlInput?.value?.trim() || 'https://canvas.mit.edu/courses/1802/lecture4_notes.pdf';
  const pageTitle = simTitleInput?.value?.trim() || 'MIT CS101 Lecture 4 - Recursion';
  const filename = url.split('/').pop()?.split('?')[0] || 'document.pdf';
  const detectedCategory = detectCategory(filename);
  const categoryFolder = (CATEGORY_FOLDER_NAMES as any)[detectedCategory] || 'Documents';

  const defaultSavePath = (document.getElementById('setting-save-path') as HTMLInputElement)?.value?.trim() || '';
  const structure = (document.getElementById('setting-smart-structure') as HTMLSelectElement)?.value as any || 'contextual';
  const clean = (document.getElementById('setting-smart-clean-filename') as HTMLInputElement)?.checked ?? true;
  const organizeCategories = structure === 'category' || structure === 'contextual';

  const engine = new RoutingEngine(getRoutingRules());
  const res = resolveDownloadRoute({
    url,
    filename,
    category: detectedCategory,
    categoryFolder,
    pageTitle,
    settings: {
      ...state.settings,
      defaultSavePath,
      organizeByCategoryFolders: organizeCategories,
      enableRoutingRules: (document.getElementById('setting-enable-routing') as HTMLInputElement)?.checked ?? true,
      enableSmartRouting: (document.getElementById('setting-enable-smart-routing') as HTMLInputElement)?.checked ?? true,
      smartRoutingStructure: structure,
      smartFilenameClean: clean,
    },
    routingEngine: engine,
  });

  const isSmartOn = (document.getElementById('setting-enable-smart-routing') as HTMLInputElement)?.checked ?? true;
  const matchSource = res.matchedRuleId
    ? `<span class="sim-source-tag rule">⚡ Custom User Rule Matched</span>`
    : (res.semantic ? `<span class="sim-source-tag semantic">✨ Contextual Intent Classifier (${Math.round((res.semantic.confidence || 0) * 100)}% Conf)</span>` : (isSmartOn ? `<span class="sim-source-tag default">📁 Default Fallback Directory</span>` : `<span class="sim-source-tag disabled">⚪ Direct Base Folder (Auto-Organizer Off)</span>`));

  const folderDisplay = res.savePath.includes('/') ? res.savePath.slice(0, res.savePath.lastIndexOf('/')) : '';
  const fullFolderText = folderDisplay ? `Downloads/${folderDisplay}/` : 'Downloads/';

  card.innerHTML = `
    <div class="sim-result-header">
      <div class="sim-result-badges">
        ${matchSource}
        ${res.smartBadge ? `<span class="sim-shelf-badge">${res.smartBadge.icon} ${res.smartBadge.label}</span>` : ''}
      </div>
    </div>
    <div class="sim-path-display">
      <span class="sim-path-label">Destination Folder:</span>
      <div class="sim-path-val">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span>${fullFolderText}</span>
      </div>
    </div>
    <div class="sim-filename-display">
      <span class="sim-path-label">Smart Filename:</span>
      <div class="sim-filename-val">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>${res.filename}</span>
      </div>
    </div>
    ${res.semantic?.entities ? `
      <div class="sim-entities-row">
        <span class="sim-entities-label">Extracted Context:</span>
        ${res.semantic.entities.organization ? `<span class="sim-entity-tag">🏛️ ${res.semantic.entities.organization}</span>` : ''}
        ${res.semantic.entities.identifier ? `<span class="sim-entity-tag">🏷️ ID: ${res.semantic.entities.identifier}</span>` : ''}
        ${res.semantic.entities.year ? `<span class="sim-entity-tag">📅 Year: ${res.semantic.entities.year}</span>` : ''}
        ${res.semantic.entities.month ? `<span class="sim-entity-tag">🗓️ Month: ${res.semantic.entities.month}</span>` : ''}
        ${res.semantic.entities.pathBreadcrumbs && res.semantic.entities.pathBreadcrumbs.length > 0 ? `<span class="sim-entity-tag">📂 Breadcrumb: ${res.semantic.entities.pathBreadcrumbs.join(' / ')}</span>` : ''}
      </div>
    ` : ''}
  `;
}


