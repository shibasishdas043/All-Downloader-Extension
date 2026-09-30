// ============================================================
//  All-Downloader — Dashboard Sidebar & Badge Manager
// ============================================================
import { DOWNLOAD_STATE } from '../../shared/constants.js';
import { formatSpeed } from '../../shared/utils.js';
import { state } from './state.js';

export function bindNav(onNavigate: (view: string) => void): void {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = (btn as HTMLElement).dataset.view;
      if (!view) return;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onNavigate(view);
    });
  });
}

export function updateSidebarStats(): void {
  const all = Object.values(state.downloads);
  const active = all.filter(d => d.state === DOWNLOAD_STATE.DOWNLOADING);
  const speed = active.reduce((s, d) => s + (d.speed || 0), 0);

  const $speed = document.getElementById('sidebar-total-speed');
  const $count = document.getElementById('sidebar-active-count');
  const $dot = document.getElementById('sidebar-active-dot');

  if ($speed) $speed.textContent = formatSpeed(speed);
  if ($count) $count.textContent = String(active.length);
  if ($dot) $dot.classList.toggle('is-active', active.length > 0);
}

export function updateBadges(): void {
  const all = Object.values(state.downloads);
  const active = all.filter(d => [DOWNLOAD_STATE.DOWNLOADING, DOWNLOAD_STATE.QUEUED, DOWNLOAD_STATE.CONNECTING].includes(d.state));
  const queue = all.filter(d => d.state === DOWNLOAD_STATE.QUEUED);

  const $badge = document.getElementById('nav-badge-downloads');
  if ($badge) {
    $badge.textContent = String(active.length);
    $badge.hidden = active.length === 0;
  }

  const $qBadge = document.getElementById('nav-badge-queue');
  if ($qBadge) {
    $qBadge.textContent = String(queue.length);
    $qBadge.hidden = queue.length === 0;
  }
}
