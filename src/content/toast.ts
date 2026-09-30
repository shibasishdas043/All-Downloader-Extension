// ============================================================
//  All-Downloader — In-Page Download Started Toast Component
//  Displays a polished, high-contrast Vercel Geist notification
//  Strictly matches Dashboard & Popup design: No borders, no outlines.
// ============================================================

export function displayInPageToast(filename: string): void {
  const TOAST_ID = '__adl-download-toast';
  const existing = document.getElementById(TOAST_ID);
  if (existing) {
    existing.remove();
  }

  const container = document.createElement('div');
  container.id = TOAST_ID;

  // Use Shadow DOM to strictly isolate styles from any host page CSS
  const shadow = container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial !important;
      position: fixed !important;
      top: 20px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      font-family: 'Geist', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }
    *, *::before, *::after {
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      outline: none !important;
    }
    .adl-toast {
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      width: 320px !important;
      min-height: 62px !important;
      padding: 12px 16px !important;
      background: #ffffff !important;
      color: #0f172a !important;
      border-radius: 12px !important;
      border: none !important;
      outline: none !important;
      box-shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.16), 0 4px 12px -2px rgba(0, 0, 0, 0.08) !important;
      overflow: hidden !important;
      animation: adlSlideDown 220ms cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
    }
    .adl-toast.closing {
      animation: adlSlideUp 180ms cubic-bezier(0.4, 0, 1, 1) forwards !important;
    }
    @keyframes adlSlideDown {
      from {
        opacity: 0;
        transform: translateY(-16px) scale(0.96);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
    @keyframes adlSlideUp {
      from {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      to {
        opacity: 0;
        transform: translateY(-12px) scale(0.96);
      }
    }
    .badge-box {
      width: 38px !important;
      height: 38px !important;
      border-radius: 8px !important;
      background: #e2e8f0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      border: none !important;
      outline: none !important;
    }
    .badge-text {
      font-family: 'Geist Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      color: #0f172a !important;
      text-transform: uppercase !important;
      letter-spacing: 0.6px !important;
      line-height: 1 !important;
      border: none !important;
      outline: none !important;
    }
    .info-column {
      flex: 1 !important;
      min-width: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 3px !important;
      justify-content: center !important;
      border: none !important;
      outline: none !important;
    }
    .type-label {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #64748b !important;
      text-transform: uppercase !important;
      letter-spacing: 0.5px !important;
      line-height: 1.2 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      border: none !important;
      outline: none !important;
    }
    .file-name {
      font-size: 13.5px !important;
      font-weight: 600 !important;
      color: #0f172a !important;
      line-height: 1.3 !important;
      letter-spacing: -0.2px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      display: block !important;
      max-width: 240px !important;
      border: none !important;
      outline: none !important;
    }
  `;

  const safeName = filename || 'download';
  const parts = safeName.split('.');
  const ext = parts.length > 1 ? (parts.pop() || '').toUpperCase().slice(0, 4) : 'FILE';

  const escapedName = safeName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const toast = document.createElement('div');
  toast.className = 'adl-toast';
  toast.innerHTML = `
    <div class="badge-box">
      <span class="badge-text">${ext}</span>
    </div>
    <div class="info-column">
      <span class="type-label">Download Started</span>
      <span class="file-name" title="${escapedName}">${escapedName}</span>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(toast);
  document.documentElement.appendChild(container);

  let isDismissed = false;
  const dismiss = () => {
    if (isDismissed) return;
    isDismissed = true;
    toast.classList.add('closing');
    setTimeout(() => {
      container.remove();
    }, 180);
  };

  // Auto-dismiss after exactly 5 seconds
  setTimeout(dismiss, 5000);
}
