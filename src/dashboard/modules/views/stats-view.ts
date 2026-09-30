// ============================================================
//  All-Downloader — Statistics & Analytics Visualization View
// ============================================================
import { DOWNLOAD_STATE, MSG } from '../../../shared/constants.js';
import { formatBytes, formatSpeed, detectCategory } from '../../../shared/utils.js';
import { state } from '../state.js';
import { sendMsg } from '../api.js';
import { escHtml } from '../dom-helpers.js';

export async function renderStats(): Promise<void> {
  const res = await sendMsg({ type: MSG.GET_DOWNLOADS });
  const all = res?.downloads || [];

  const completedDownloads = all.filter((d: any) => d.state === DOWNLOAD_STATE.COMPLETED);
  const totalFiles = completedDownloads.length;
  const totalSize = completedDownloads.reduce((s: number, d: any) => s + (d.total || d.received || 0), 0);

  // Accurately compute positive elapsed download durations
  const completedTimeMs = completedDownloads.reduce((sum: number, d: any) => {
    if (d.completedAt && d.startedAt && d.completedAt > d.startedAt) {
      return sum + (d.completedAt - d.startedAt);
    }
    return sum;
  }, 0);

  const activeDownloads = all.filter((d: any) => d.state === DOWNLOAD_STATE.DOWNLOADING);
  const activeTimeMs = activeDownloads.reduce((sum: number, d: any) => {
    if (d.startedAt && Date.now() > d.startedAt) {
      return sum + (Date.now() - d.startedAt);
    }
    return sum;
  }, 0);

  const totalTimeMs = Math.max(0, completedTimeMs + activeTimeMs);

  // Real-time weighted average download speed
  let avgSpeedBps = 0;
  if (activeDownloads.length > 0) {
    avgSpeedBps = activeDownloads.reduce((s: number, d: any) => s + (d.speed || 0), 0) / activeDownloads.length;
  } else if (totalTimeMs > 0 && totalSize > 0) {
    avgSpeedBps = totalSize / (totalTimeMs / 1000);
  }

  // Modern Geist SVG icons replacing OS emojis
  const statIcons = [
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
  ];

  document.querySelectorAll('.stat-card').forEach((card, idx) => {
    (card as HTMLElement).style.setProperty('--stagger', String(idx));
    const iconEl = card.querySelector('.stat-icon');
    if (iconEl && statIcons[idx]) iconEl.innerHTML = statIcons[idx];
  });

  const totalFilesEl = document.getElementById('stat-total-files');
  if (totalFilesEl) totalFilesEl.textContent = totalFiles.toLocaleString();

  const totalSizeEl = document.getElementById('stat-total-size');
  if (totalSizeEl) totalSizeEl.textContent = formatBytes(totalSize);

  const avgSpeedEl = document.getElementById('stat-avg-speed');
  if (avgSpeedEl) avgSpeedEl.textContent = formatSpeed(avgSpeedBps);

  const totalMin = Math.floor(totalTimeMs / 60000);
  const totalSec = Math.floor((totalTimeMs % 60000) / 1000);
  const totalTimeEl = document.getElementById('stat-total-time');
  if (totalTimeEl) {
    totalTimeEl.textContent = totalMin > 60
      ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
      : totalMin > 0 ? `${totalMin}m ${totalSec}s` : `${totalSec}s`;
  }

  drawCategoryChart(all);
}

export function drawCategoryChart(allDownloads: any[]): void {
  if (state.currentView !== 'stats') return;
  const canvas = document.getElementById('chart-category') as HTMLCanvasElement | null;
  const distBar = document.getElementById('cat-distribution-bar');
  const pillsWrap = document.getElementById('cat-pills-wrap');
  const canvasWrap = document.getElementById('chart-canvas-wrap');
  const emptyState = document.getElementById('chart-empty-state');
  const totalBadge = document.getElementById('chart-total-badge');

  if (!canvas) return;

  // Aggregate category counts and volume sizes
  const catStats: Record<string, { count: number; bytes: number }> = {};
  let totalCategorizedCount = 0;
  let totalCategorizedBytes = 0;

  for (const dl of allDownloads) {
    const cat = (dl.category || detectCategory(dl.filename, (dl as any).mimeType) || 'other').toLowerCase();
    if (!catStats[cat]) {
      catStats[cat] = { count: 0, bytes: 0 };
    }
    const bytes = dl.total || dl.received || 0;
    catStats[cat].count += 1;
    catStats[cat].bytes += bytes;
    totalCategorizedCount += 1;
    totalCategorizedBytes += bytes;
  }

  const sortedCats = Object.entries(catStats).sort((a, b) => b[1].count - a[1].count || b[1].bytes - a[1].bytes);

  if (sortedCats.length === 0) {
    if (distBar) distBar.hidden = true;
    if (pillsWrap) pillsWrap.hidden = true;
    if (canvasWrap) canvasWrap.hidden = true;
    if (emptyState) emptyState.hidden = false;
    if (totalBadge) totalBadge.textContent = '0 categories';
    return;
  }

  // Active state: show distribution bar, pills, and chart
  if (emptyState) emptyState.hidden = true;
  if (distBar) distBar.hidden = false;
  if (pillsWrap) pillsWrap.hidden = false;
  if (canvasWrap) canvasWrap.hidden = false;
  if (totalBadge) totalBadge.textContent = `${sortedCats.length} ${sortedCats.length === 1 ? 'category' : 'categories'}`;

  // Modern distinct category palette (slate/indigo/teal/amber/rose/cyan)
  const categoryPalette: Record<string, { fill: string; dot: string }> = {
    image:       { fill: '#0284c7', dot: '#0284c7' }, // Sky
    video:       { fill: '#6366f1', dot: '#6366f1' }, // Indigo
    audio:       { fill: '#8b5cf6', dot: '#8b5cf6' }, // Purple
    archive:     { fill: '#f59e0b', dot: '#f59e0b' }, // Amber
    document:    { fill: '#10b981', dot: '#10b981' }, // Emerald
    application: { fill: '#0f172a', dot: '#0f172a' }, // Slate Ink
    other:       { fill: '#64748b', dot: '#64748b' }, // Muted Slate
  };

  const getCatColor = (cat: string, index: number) => {
    const key = cat.toLowerCase();
    if (categoryPalette[key]) return categoryPalette[key];
    const fallbackList = ['#0f172a', '#0284c7', '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#64748b'];
    const color = fallbackList[index % fallbackList.length];
    return { fill: color, dot: color };
  };

  // 1. Proportional Distribution Bar
  if (distBar) {
    distBar.innerHTML = '';
    sortedCats.forEach(([cat, data], idx) => {
      const pct = Math.max(3, ((data.count / totalCategorizedCount) * 100));
      const { fill } = getCatColor(cat, idx);
      const seg = document.createElement('div');
      seg.className = 'cat-dist-segment';
      seg.style.width = `${pct}%`;
      seg.style.background = fill;
      seg.title = `${cat.toUpperCase()}: ${data.count} ${data.count === 1 ? 'file' : 'files'} (${pct.toFixed(1)}%) • ${formatBytes(data.bytes)}`;
      distBar.appendChild(seg);
    });
  }

  // 2. Category Summary Metric Pills
  if (pillsWrap) {
    pillsWrap.innerHTML = '';
    sortedCats.forEach(([cat, data], idx) => {
      const pct = ((data.count / totalCategorizedCount) * 100).toFixed(0);
      const { dot } = getCatColor(cat, idx);
      const pill = document.createElement('div');
      pill.className = 'cat-metric-pill';
      pill.innerHTML = `
        <span class="cat-pill-dot" style="background: ${dot}"></span>
        <span class="cat-pill-name">${escHtml(cat)}</span>
        <span class="cat-pill-stats">${data.count} ${data.count === 1 ? 'file' : 'files'} • ${formatBytes(data.bytes)} (${pct}%)</span>
      `;
      pillsWrap.appendChild(pill);
    });
  }

  // 3. Precision Retina Canvas Bar Chart
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const parentWidth = canvasWrap ? canvasWrap.clientWidth : 600;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(340, parentWidth);
  const H = 230;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const chartBottom = H - 42;
  const chartTop = 34;
  const chartHeight = chartBottom - chartTop;
  const maxVal = Math.max(...sortedCats.map(c => c[1].count), 1);

  // Gridlines & Axis Markers
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)';
  ctx.lineWidth = 1;

  // 50% line
  ctx.beginPath();
  ctx.moveTo(35, chartTop + chartHeight / 2);
  ctx.lineTo(W - 20, chartTop + chartHeight / 2);
  ctx.stroke();

  // Baseline
  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(35, chartBottom);
  ctx.lineTo(W - 20, chartBottom);
  ctx.stroke();

  // Y-axis value labels
  ctx.fillStyle = '#64748b';
  ctx.font = '600 10px Geist Mono, ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(maxVal.toString(), 28, chartTop + 4);
  ctx.fillText(Math.round(maxVal / 2).toString(), 28, chartTop + chartHeight / 2 + 3);
  ctx.fillText('0', 28, chartBottom + 3);

  const count = sortedCats.length;
  const availableWidth = W - 70;
  const slotWidth = availableWidth / count;
  const barWidth = Math.min(56, Math.max(28, slotWidth * 0.48));

  sortedCats.forEach(([cat, data], i) => {
    const centerX = 45 + i * slotWidth + slotWidth / 2;
    const barX = centerX - barWidth / 2;
    const barH = Math.max(6, Math.round((data.count / maxVal) * chartHeight));
    const barY = chartBottom - barH;
    const { fill } = getCatColor(cat, i);

    // Rounded bar
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barH, [6, 6, 0, 0]);
    ctx.fill();

    // Value count on top of bar
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 12px Geist Mono, ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(data.count.toString(), centerX, barY - 14);

    // Sub-metric bytes below count
    ctx.fillStyle = '#64748b';
    ctx.font = '600 9.5px Geist Mono, ui-monospace, monospace';
    ctx.fillText(formatBytes(data.bytes), centerX, barY - 3);

    // Category label below baseline
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 10.5px Geist Mono, ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(cat.toUpperCase(), centerX, chartBottom + 20);
  });
}
