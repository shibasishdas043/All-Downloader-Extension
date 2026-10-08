// ============================================================
//  All-Downloader — Page Sniffer Controller (Shared Logic)
// ============================================================
import { MSG } from './constants.js';
import type { SniffedMediaItem } from './types.js';

export interface SnifferDOMRefs {
  modal: HTMLElement;
  pageTitle: HTMLElement;
  loading: HTMLElement;
  empty: HTMLElement;
  list: HTMLElement;
  filterInput: HTMLInputElement;
  selectAllCheckbox: HTMLInputElement;
  selectedCountLabel: HTMLElement;
  downloadBtn: HTMLButtonElement;
  closeBtn?: HTMLElement;
  cntAll: HTMLElement;
  cntImage: HTMLElement;
  cntVideo: HTMLElement;
  cntAudio: HTMLElement;
  cntDocument: HTMLElement;
  targetUrlInput?: HTMLInputElement;
  scanBtn?: HTMLElement;
  tabsDatalist?: HTMLDataListElement;
}

export class SnifferController {
  private refs: SnifferDOMRefs;
  private items: SniffedMediaItem[] = [];
  private selectedUrls = new Set<string>();
  private activeType: string = 'all';
  private searchQuery: string = '';
  private onDownloadBatch: (items: SniffedMediaItem[]) => Promise<void>;

  constructor(
    refs: SnifferDOMRefs,
    onDownloadBatch: (items: SniffedMediaItem[]) => Promise<void>
  ) {
    this.refs = refs;
    this.onDownloadBatch = onDownloadBatch;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.refs.closeBtn?.addEventListener('click', () => this.hide());
    this.refs.modal.addEventListener('click', (e) => {
      if (e.target === this.refs.modal) this.hide();
    });

    this.refs.filterInput.addEventListener('input', () => {
      this.searchQuery = this.refs.filterInput.value.toLowerCase().trim();
      this.renderList();
    });

    this.refs.selectAllCheckbox.addEventListener('change', () => {
      const visible = this.getFilteredItems();
      if (this.refs.selectAllCheckbox.checked) {
        visible.forEach((it) => this.selectedUrls.add(it.url));
      } else {
        visible.forEach((it) => this.selectedUrls.delete(it.url));
      }
      this.updateSelectionState();
      this.renderList();
    });

    this.refs.downloadBtn.addEventListener('click', async () => {
      const selected = this.items.filter((it) => this.selectedUrls.has(it.url));
      if (selected.length === 0) return;
      this.refs.downloadBtn.disabled = true;
      const btnSpan = this.refs.downloadBtn.querySelector('span');
      if (btnSpan) btnSpan.textContent = `Queuing (${selected.length})…`;
      else this.refs.downloadBtn.textContent = `Queuing (${selected.length})…`;
      try {
        await this.onDownloadBatch(selected);
        this.hide();
      } finally {
        this.refs.downloadBtn.disabled = false;
        this.updateSelectionState();
      }
    });

    // Tab buttons
    this.refs.modal.querySelectorAll('.sniffer-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.refs.modal.querySelectorAll('.sniffer-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeType = (btn as HTMLElement).dataset.type || 'all';
        this.renderList();
      });
    });

    // Target URL scanning
    this.refs.scanBtn?.addEventListener('click', () => {
      const url = this.refs.targetUrlInput?.value.trim() || '';
      this.scan(url);
    });

    this.refs.targetUrlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = this.refs.targetUrlInput?.value.trim() || '';
        this.scan(url);
      }
    });

    this.refs.targetUrlInput?.addEventListener('change', () => {
      const url = this.refs.targetUrlInput?.value.trim() || '';
      if (url) this.scan(url);
    });
  }

  public async scan(url?: string): Promise<void> {
    this.refs.loading.classList.remove('hidden');
    this.refs.loading.hidden = false;
    this.refs.empty.classList.add('hidden');
    this.refs.empty.hidden = true;
    this.refs.list.innerHTML = '';
    this.selectedUrls.clear();
    this.items = [];
    this.searchQuery = '';
    this.refs.filterInput.value = '';
    this.updateSelectionState();

    try {
      const response = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: MSG.SNIFF_PAGE, payload: { url } }, (res) => {
          resolve(res || { ok: false, error: chrome.runtime.lastError?.message });
        });
      });

      this.refs.loading.classList.add('hidden');
      this.refs.loading.hidden = true;

      if (response?.pageUrl && this.refs.targetUrlInput) {
        this.refs.targetUrlInput.value = response.pageUrl;
      }

      if (Array.isArray(response?.availableTabs) && this.refs.tabsDatalist) {
        this.refs.tabsDatalist.innerHTML = '';
        response.availableTabs.forEach((tab: any) => {
          if (tab.url) {
            const opt = document.createElement('option');
            opt.value = tab.url;
            opt.label = tab.title || tab.url;
            this.refs.tabsDatalist!.appendChild(opt);
          }
        });
      }

      if (response && response.ok && Array.isArray(response.items)) {
        this.items = response.items;
        this.refs.pageTitle.textContent = response.pageTitle || 'Resources Scanned';
        this.updateCounts();
        this.renderList();
      } else {
        this.refs.empty.classList.remove('hidden');
        this.refs.empty.hidden = false;
        this.refs.empty.textContent = response?.error || 'No downloadable resources found on active page';
      }
    } catch (err: any) {
      this.refs.loading.classList.add('hidden');
      this.refs.loading.hidden = true;
      this.refs.empty.classList.remove('hidden');
      this.refs.empty.hidden = false;
      this.refs.empty.textContent = err?.message || 'Failed to scan resources';
    }
  }

  public async open(): Promise<void> {
    this.refs.modal.classList.remove('hidden');
    this.refs.modal.hidden = false;
    const initialUrl = this.refs.targetUrlInput?.value.trim() || undefined;
    await this.scan(initialUrl);
  }

  public hide(): void {
    this.refs.modal.classList.add('hidden');
    this.refs.modal.hidden = true;
  }

  private updateCounts(): void {
    const counts = { all: this.items.length, image: 0, video: 0, audio: 0, document: 0, link: 0 };
    for (const it of this.items) {
      if (counts[it.type] !== undefined) {
        counts[it.type]++;
      }
    }
    this.refs.cntAll.textContent = String(counts.all);
    this.refs.cntImage.textContent = String(counts.image);
    this.refs.cntVideo.textContent = String(counts.video);
    this.refs.cntAudio.textContent = String(counts.audio);
    this.refs.cntDocument.textContent = String(counts.document);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private getFilteredItems(): SniffedMediaItem[] {
    return this.items.filter((it) => {
      if (this.activeType !== 'all' && it.type !== this.activeType) {
        return false;
      }
      if (this.searchQuery) {
        const matchesName = it.filename.toLowerCase().includes(this.searchQuery);
        const matchesUrl = it.url.toLowerCase().includes(this.searchQuery);
        const matchesExt = it.ext ? it.ext.toLowerCase().includes(this.searchQuery) : false;
        const matchesRes = it.resolution ? it.resolution.toLowerCase().includes(this.searchQuery) : false;
        const matchesOrigin = it.origin ? it.origin.toLowerCase().includes(this.searchQuery) : false;
        if (!matchesName && !matchesUrl && !matchesExt && !matchesRes && !matchesOrigin) return false;
      }
      return true;
    });
  }

  private renderList(): void {
    const visible = this.getFilteredItems();
    this.refs.list.innerHTML = '';

    if (visible.length === 0) {
      this.refs.empty.classList.remove('hidden');
      this.refs.empty.hidden = false;
      this.refs.empty.textContent = 'No matching resources found';
      this.updateSelectionState();
      return;
    }

    this.refs.empty.classList.add('hidden');
    this.refs.empty.hidden = true;
    const frag = document.createDocumentFragment();

    visible.forEach((it) => {
      const row = document.createElement('div');
      row.className = `sniffer-row ${this.selectedUrls.has(it.url) ? 'selected' : ''}`;

      const extText = (it.ext || it.type || 'file').slice(0, 4).toUpperCase();
      const isImg = it.type === 'image' && it.url.startsWith('http');
      const safeFilename = this.escapeHtml(it.filename);
      const safeUrl = this.escapeHtml(it.url);
      const displayUrl = this.escapeHtml(it.url.replace(/^https?:\/\//i, ''));
      const safeRes = it.resolution ? this.escapeHtml(it.resolution) : '';
      const safeOrigin = it.origin && it.origin.toLowerCase() !== 'link' ? this.escapeHtml(it.origin.toUpperCase()) : '';

      row.innerHTML = `
        <label class="sniffer-check-label">
          <input type="checkbox" class="sniffer-item-check" ${this.selectedUrls.has(it.url) ? 'checked' : ''} />
        </label>
        <div class="sniffer-preview-wrap">
          ${
            isImg
              ? `<img class="sniffer-thumb" src="${safeUrl}" alt="" loading="lazy" />`
              : `<span class="sniffer-badge-ext">${extText}</span>`
          }
        </div>
        <div class="sniffer-meta">
          <div class="sniffer-meta-header">
            <span class="sniffer-filename" title="${safeFilename}">${safeFilename}</span>
            ${safeRes ? `<span class="sniffer-badge-res">${safeRes}</span>` : ''}
            ${safeOrigin ? `<span class="sniffer-badge-origin">${safeOrigin}</span>` : ''}
          </div>
          <span class="sniffer-url" title="${safeUrl}">${displayUrl}</span>
        </div>
      `;

      const check = row.querySelector('.sniffer-item-check') as HTMLInputElement;
      check.addEventListener('change', () => {
        if (check.checked) {
          this.selectedUrls.add(it.url);
          row.classList.add('selected');
        } else {
          this.selectedUrls.delete(it.url);
          row.classList.remove('selected');
        }
        this.updateSelectionState();
      });

      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.sniffer-check-label')) return;
        check.checked = !check.checked;
        check.dispatchEvent(new Event('change'));
      });

      frag.appendChild(row);
    });

    this.refs.list.appendChild(frag);
    this.updateSelectionState();
  }

  private updateSelectionState(): void {
    const visible = this.getFilteredItems();
    const count = this.selectedUrls.size;

    this.refs.selectedCountLabel.textContent = `${count} selected`;
    this.refs.downloadBtn.disabled = count === 0;

    const btnSpan = this.refs.downloadBtn.querySelector('span');
    const label = count > 0 ? `Download (${count})` : 'Download Selected';
    if (btnSpan) {
      btnSpan.textContent = label;
    } else {
      this.refs.downloadBtn.textContent = label;
    }

    if (visible.length > 0 && visible.every((it) => this.selectedUrls.has(it.url))) {
      this.refs.selectAllCheckbox.checked = true;
      this.refs.selectAllCheckbox.indeterminate = false;
    } else if (visible.some((it) => this.selectedUrls.has(it.url))) {
      this.refs.selectAllCheckbox.checked = false;
      this.refs.selectAllCheckbox.indeterminate = true;
    } else {
      this.refs.selectAllCheckbox.checked = false;
      this.refs.selectAllCheckbox.indeterminate = false;
    }
  }
}
