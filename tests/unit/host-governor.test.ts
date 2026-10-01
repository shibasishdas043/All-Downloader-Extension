// ============================================================
//  Unit Tests — Fair-Share Host Connection Governor
// ============================================================
import { describe, test, expect } from 'vitest';
import { HostConnectionGovernor, getNormalizedOrigin } from '../../src/background/download-engine/host-governor.ts';

describe('HostConnectionGovernor (Fair-Share Concurrency)', () => {
  test('normalizes URLs to origin correctly', () => {
    expect(getNormalizedOrigin('https://software.download.prss.microsoft.com/db/Win10.iso?token=123'))
      .toBe('https://software.download.prss.microsoft.com');

    expect(getNormalizedOrigin('https://SOFTWARE.DOWNLOAD.PRSS.MICROSOFT.COM/Win11.iso'))
      .toBe('https://software.download.prss.microsoft.com');

    expect(getNormalizedOrigin('invalid-url')).toBe('default');
  });

  test('calculates fair-share quota dynamically across multiple downloads on same host', () => {
    const governor = new HostConnectionGovernor();
    const url = 'https://software.download.prss.microsoft.com/file.iso';

    // 1 download: gets full host data capacity (5 sockets)
    governor.registerDownload('dl_1', url);
    expect(governor.getAllocatedQuota('dl_1', url, 8)).toBe(5);

    // 2 downloads: 5 sockets split fairly into 3 and 2
    governor.registerDownload('dl_2', url);
    expect(governor.getAllocatedQuota('dl_1', url, 8)).toBe(3);
    expect(governor.getAllocatedQuota('dl_2', url, 8)).toBe(2);

    // 3 downloads: 5 sockets split into 2, 2, and 1
    governor.registerDownload('dl_3', url);
    expect(governor.getAllocatedQuota('dl_1', url, 8)).toBe(2);
    expect(governor.getAllocatedQuota('dl_2', url, 8)).toBe(2);
    expect(governor.getAllocatedQuota('dl_3', url, 8)).toBe(1);

    // Unregistering dl_3 restores 3 and 2
    governor.unregisterDownload('dl_3', url);
    expect(governor.getAllocatedQuota('dl_1', url, 8)).toBe(3);
    expect(governor.getAllocatedQuota('dl_2', url, 8)).toBe(2);
  });

  test('allows multiple downloads on same host to acquire slots simultaneously without deadlock', async () => {
    const governor = new HostConnectionGovernor();
    const url = 'https://software.download.prss.microsoft.com/file.iso';

    governor.registerDownload('win10', url);
    governor.registerDownload('win11', url);

    // win10 acquires its fair share (3 slots)
    const rel10_a = await governor.acquireDataSlot('win10', url);
    const rel10_b = await governor.acquireDataSlot('win10', url);
    const rel10_c = await governor.acquireDataSlot('win10', url);

    // win11 acquires its fair share (2 slots) simultaneously!
    const rel11_a = await governor.acquireDataSlot('win11', url);
    const rel11_b = await governor.acquireDataSlot('win11', url);

    const snap = governor.getHostSnapshot(url);
    expect(snap.activeData).toBe(5);
    expect(snap.registeredDownloads).toBe(2);

    // Release all slots
    rel10_a(); rel10_b(); rel10_c();
    rel11_a(); rel11_b();

    const afterSnap = governor.getHostSnapshot(url);
    expect(afterSnap.activeData).toBe(0);
  });

  test('prevents starvation when second download arrives on origin with active sockets', async () => {
    const governor = new HostConnectionGovernor();
    const url = 'https://software.download.prss.microsoft.com/file.iso';

    // Download 1 starts alone and consumes full capacity (5 slots)
    governor.registerDownload('win10', url);
    const slotsWin10 = await Promise.all([
      governor.acquireDataSlot('win10', url),
      governor.acquireDataSlot('win10', url),
      governor.acquireDataSlot('win10', url),
      governor.acquireDataSlot('win10', url),
      governor.acquireDataSlot('win10', url),
    ]);

    // Download 2 arrives later on the same origin
    governor.registerDownload('win11', url);
    expect(governor.getAllocatedQuota('win11', url, 8)).toBe(2);

    // Download 2 MUST acquire its slots immediately without hanging or 0 B/s starvation
    const slotsWin11 = await Promise.all([
      governor.acquireDataSlot('win11', url),
      governor.acquireDataSlot('win11', url),
    ]);

    expect(slotsWin11.length).toBe(2);

    // Clean up
    slotsWin10.forEach(rel => rel());
    slotsWin11.forEach(rel => rel());
    expect(governor.getHostSnapshot(url).activeData).toBe(0);
  });

  test('isolates connection pools across different domains', async () => {
    const governor = new HostConnectionGovernor();
    const domainA = 'https://cdn.example.org/archive.zip';
    const domainB = 'https://storage.googleapis.com/package.tar.gz';

    governor.registerDownload('dl_a', domainA);
    governor.registerDownload('dl_b', domainB);

    expect(governor.getAllocatedQuota('dl_a', domainA, 8)).toBe(5);
    expect(governor.getAllocatedQuota('dl_b', domainB, 8)).toBe(5);
  });

  test('grants probe slots independently of data sockets', async () => {
    const governor = new HostConnectionGovernor();
    const url = 'https://software.download.prss.microsoft.com/file.iso';

    governor.registerDownload('dl_1', url);
    const rel1 = await governor.acquireDataSlot('dl_1', url);
    const rel2 = await governor.acquireDataSlot('dl_1', url);
    const rel3 = await governor.acquireDataSlot('dl_1', url);
    const rel4 = await governor.acquireDataSlot('dl_1', url);
    const rel5 = await governor.acquireDataSlot('dl_1', url);

    // High-priority probe slot can still be acquired instantly
    const releaseProbe = await governor.acquireProbeSlot(url);
    const snap = governor.getHostSnapshot(url);

    expect(snap.activeData).toBe(5);
    expect(snap.activeProbes).toBe(1);

    releaseProbe();
    rel1(); rel2(); rel3(); rel4(); rel5();
  });

  test('notifies origin listeners when downloads register or unregister for dynamic elastic ramping', () => {
    const governor = new HostConnectionGovernor();
    const url = 'https://software.download.prss.microsoft.com/file.iso';
    const origin = 'https://software.download.prss.microsoft.com';

    let notificationCount = 0;
    const unsubscribe = governor.onQuotaChange(origin, () => {
      notificationCount++;
    });

    // 1. First download registers
    governor.registerDownload('dl_1', url);
    expect(notificationCount).toBe(1);

    // 2. Second download registers on same origin
    governor.registerDownload('dl_2', url);
    expect(notificationCount).toBe(2);

    // 3. First download finishes and unregisters
    governor.unregisterDownload('dl_1', url);
    expect(notificationCount).toBe(3);

    // 4. Unsubscribe works
    unsubscribe();
    governor.registerDownload('dl_3', url);
    expect(notificationCount).toBe(3); // No new notification after unsubscribe
  });
});
