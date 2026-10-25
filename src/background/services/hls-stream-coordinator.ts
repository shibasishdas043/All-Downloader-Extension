// ============================================================
//  All-Downloader — HLS / DASH Stream Capture Coordinator
//  Downloads multi-segment playlists via an orderly parallel pool,
//  tracks segment completion, writes to IndexedDB storage,
//  and coordinates with offscreen document for MP4 muxing.
// ============================================================

import { parseM3U8, parseMPD, type HlsMediaPlaylist } from './hls-parser.js';
import { saveChunk, clearChunks } from '../storage.js';
import { DOWNLOAD_STATE, MSG } from '../../shared/constants.js';

export interface StreamCaptureOptions {
  id: string;
  playlistUrl: string;
  filename: string;
  referrer?: string;
}

interface ActiveJob {
  abortController: AbortController;
  isCancelled: boolean;
}

export class HlsStreamCoordinator {
  private activeJobs = new Map<string, ActiveJob>();

  constructor(private coordinator: any) {}

  /**
   * Main entry point to capture an HLS or DASH stream.
   */
  public async captureStream(options: StreamCaptureOptions): Promise<void> {
    const { id, playlistUrl, filename, referrer } = options;
    const abortController = new AbortController();
    this.activeJobs.set(id, { abortController, isCancelled: false });

    try {
      // 1. Fetch initial playlist
      await this.coordinator.updateState(id, DOWNLOAD_STATE.CONNECTING, {
        isHlsStream: true,
        hlsPlaylistUrl: playlistUrl,
        errorMessage: null,
      });

      const resp = await fetch(playlistUrl, {
        signal: abortController.signal,
        headers: referrer ? { Referer: referrer } : undefined,
      });

      if (!resp.ok) {
        throw new Error(`Failed to fetch playlist (HTTP ${resp.status})`);
      }

      const text = await resp.text();
      const isDASH = playlistUrl.toLowerCase().includes('.mpd') || text.includes('<MPD') || text.includes('xmlns="urn:mpeg:dash');
      let parsed = isDASH ? parseMPD(text, playlistUrl) : parseM3U8(text, playlistUrl);
      let mediaPlaylistUrl = playlistUrl;

      // If master playlist, resolve to highest bandwidth accessible rendition
      if (parsed.isMaster) {
        const sortedVariants = [...parsed.variants].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
        let variantLoaded = false;

        for (const variant of sortedVariants) {
          try {
            const vResp = await fetch(variant.url, {
              signal: abortController.signal,
              headers: referrer ? { Referer: referrer } : undefined,
            });

            if (vResp.ok) {
              mediaPlaylistUrl = variant.url;
              parsed = parseM3U8(await vResp.text(), mediaPlaylistUrl);
              variantLoaded = true;
              break;
            }
          } catch {
            // Try next variant
          }
        }

        if (!variantLoaded) {
          throw new Error('No accessible playable stream variants found in master playlist');
        }
      }

      const mediaPlaylist = parsed as HlsMediaPlaylist;

      if (mediaPlaylist.hasEncryption) {
        throw new Error('Stream uses AES-128 DRM encryption which cannot be captured offline.');
      }

      if (!mediaPlaylist.segments || mediaPlaylist.segments.length === 0) {
        throw new Error('Playlist contains zero playable media segments.');
      }

      const totalSegments = mediaPlaylist.segments.length;
      let completedSegments = 0;
      let totalReceivedBytes = 0;

      await this.coordinator.updateState(id, DOWNLOAD_STATE.DOWNLOADING, {
        isHlsStream: true,
        hlsSegmentCount: totalSegments,
        hlsSegmentsCompleted: 0,
        hlsTotalDuration: mediaPlaylist.totalDuration,
        total: 0, // dynamic until all segments downloaded
        filesize: 0,
        received: 0,
        receivedBytes: 0,
        progress: 0,
      });

      // 2. Parallel Segment Download Pool (Concurrency: 4)
      const concurrency = 4;
      const segmentQueue = mediaPlaylist.segments.map((seg, idx) => ({ seg, idx }));
      let lastProgressBroadcast = Date.now();

      const downloadWorker = async () => {
        while (segmentQueue.length > 0) {
          if (abortController.signal.aborted) break;
          const item = segmentQueue.shift();
          if (!item) break;

          const { seg, idx } = item;
          let retries = 3;
          let buffer: ArrayBuffer | null = null;

          while (retries > 0) {
            try {
              const segHeaders: Record<string, string> = {};
              if (referrer) segHeaders['Referer'] = referrer;
              if (seg.byteRange) {
                segHeaders['Range'] = `bytes=${seg.byteRange.offset}-${seg.byteRange.offset + seg.byteRange.length - 1}`;
              }
              const segResp = await fetch(seg.url, {
                signal: abortController.signal,
                headers: Object.keys(segHeaders).length > 0 ? segHeaders : undefined,
              });

              if (!segResp.ok) {
                throw new Error(`HTTP ${segResp.status}`);
              }

              buffer = await segResp.arrayBuffer();
              break;
            } catch (err: any) {
              if (abortController.signal.aborted) return;
              retries--;
              if (retries === 0) {
                throw new Error(`Failed downloading segment ${idx + 1}/${totalSegments}: ${err.message}`);
              }
              await new Promise((r) => setTimeout(r, 600));
            }
          }

          if (buffer) {
            await saveChunk(id, idx, buffer);
            completedSegments++;
            totalReceivedBytes += buffer.byteLength;

            const now = Date.now();
            if (now - lastProgressBroadcast > 250 || completedSegments === totalSegments) {
              lastProgressBroadcast = now;
              const percent = Math.min(99, Math.round((completedSegments / totalSegments) * 100));
              await this.coordinator.updateState(id, DOWNLOAD_STATE.DOWNLOADING, {
                hlsSegmentsCompleted: completedSegments,
                receivedBytes: totalReceivedBytes,
                received: totalReceivedBytes,
                progress: percent,
              });
            }
          }
        }
      };

      // Launch worker pool
      const workers = Array.from({ length: Math.min(concurrency, totalSegments) }, () => downloadWorker());
      await Promise.all(workers);

      if (abortController.signal.aborted) {
        return;
      }

      // 3. Demux & Remux via Offscreen Document
      await this.coordinator.updateState(id, DOWNLOAD_STATE.MERGING, {
        progress: 100,
        receivedBytes: totalReceivedBytes,
        received: totalReceivedBytes,
        filesize: totalReceivedBytes,
        total: totalReceivedBytes,
      });

      if (this.coordinator.ensureOffscreenDocument) {
        await this.coordinator.ensureOffscreenDocument();
      }

      const muxResponse = await new Promise<{ success: boolean; blobUrl?: string; size?: number; error?: string }>(
        (resolve) => {
          chrome.runtime.sendMessage(
            {
              type: MSG.OFFSCREEN_MUX_SEGMENTS,
              downloadId: id,
              segmentCount: totalSegments,
              filename,
            },
            (response) => {
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
              } else {
                resolve(response || { success: false, error: 'No response from offscreen document' });
              }
            }
          );
        }
      );

      if (!muxResponse || !muxResponse.success || !muxResponse.blobUrl) {
        throw new Error(muxResponse?.error || 'Muxing segments into MP4 failed');
      }

      const finalBlobUrl = muxResponse.blobUrl;
      const finalSize = muxResponse.size || totalReceivedBytes;

      // 4. Register blob save and trigger native browser save
      if (this.coordinator.ownBlobUrls) {
        this.coordinator.ownBlobUrls.add(finalBlobUrl);
      }

      if (this.coordinator.pendingBlobSaves) {
        this.coordinator.pendingBlobSaves.set(finalBlobUrl, {
          id,
          targetSavePath: filename,
          safeFilename: filename.split('/').pop() || filename,
          fileSize: finalSize,
        });
      }

      await new Promise<void>((resolve, reject) => {
        chrome.downloads.download(
          {
            url: finalBlobUrl,
            filename,
            conflictAction: 'uniquify',
            saveAs: false,
          },
          (chromeDlId) => {
            if (chrome.runtime.lastError || !chromeDlId) {
              reject(new Error(chrome.runtime.lastError?.message || 'chrome.downloads.download failed'));
            } else {
              this.coordinator.updateState(id, DOWNLOAD_STATE.COMPLETED, {
                chromeDownloadId: chromeDlId,
                completedAt: Date.now(),
              });
              resolve();
            }
          }
        );
      });
    } catch (err: any) {
      if (this.activeJobs.get(id)?.isCancelled) {
        return;
      }
      console.error(`[ADL HLS] Error capturing stream ${id}:`, err);
      await this.coordinator.updateState(id, DOWNLOAD_STATE.ERROR, {
        errorMessage: err.message || String(err),
      });
    } finally {
      this.activeJobs.delete(id);
    }
  }

  /**
   * Cancel an in-flight stream capture job.
   */
  public cancel(id: string): void {
    const job = this.activeJobs.get(id);
    if (job) {
      job.isCancelled = true;
      job.abortController.abort();
      this.activeJobs.delete(id);
      clearChunks(id).catch(() => {});
    }
  }
}
