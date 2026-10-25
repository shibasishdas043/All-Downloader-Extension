// ============================================================
//  Unit Tests — Smart Directory Routing & Filename Template Engine
// ============================================================
import { describe, test, expect } from 'vitest';
import {
  RoutingEngine,
  expandTokens,
  buildRoutingContext,
} from '../../src/background/services/routing-engine.js';
import type { RoutingRule } from '../../src/shared/types.js';

describe('expandTokens', () => {
  const baseCtx = {
    url: 'https://www.github.com/torvalds/linux/archive/v6.0.zip',
    domain: 'github.com',
    category: 'archive' as const,
    categoryFolder: 'Archives',
    ext: 'zip',
    stemName: 'v6.0',
    filename: 'v6.0.zip',
    pageTitle: 'Release v6.0 · torvalds/linux · GitHub',
  };

  test('expands basic tokens: domain, tld, category, ext, original_name', () => {
    const tpl = '{category}/{domain}/{original_name}.{ext}';
    expect(expandTokens(tpl, baseCtx)).toBe('Archives/github.com/v6.0.zip');
  });

  test('expands tld token correctly from domain', () => {
    expect(expandTokens('{tld}', baseCtx)).toBe('com');
    expect(expandTokens('{tld}', { ...baseCtx, domain: 'sub.site.co.uk' })).toBe('uk');
  });

  test('expands date tokens: date, year, month, day', () => {
    const result = expandTokens('{year}/{month}/{day}/{date}', baseCtx);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const expected = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    expect(result).toBe(expected);
  });

  test('expands and sanitizes page title', () => {
    const ctx = {
      ...baseCtx,
      pageTitle: 'My: Dangerous* Title? <With> | Bad / Chars',
    };
    const result = expandTokens('{title}_{original_name}', ctx);
    expect(result).not.toContain(':');
    expect(result).not.toContain('*');
    expect(result).not.toContain('?');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('|');
    expect(result).not.toContain('/');
    expect(result).toContain('v6.0');
  });

  test('expands dynamic tokens: site, subdomain, quarter, timestamp', () => {
    const subCtx = {
      ...baseCtx,
      domain: 'cdn.assets.example.com',
    };
    const res = expandTokens('{subdomain}/{site}/{quarter}', subCtx);
    expect(res).toContain('cdn.assets/example/Q');

    const tsRes = expandTokens('{timestamp}', baseCtx);
    expect(Number(tsRes)).toBeGreaterThan(0);
  });

  test('returns empty string on empty template', () => {
    expect(expandTokens('', baseCtx)).toBe('');
  });
});

describe('buildRoutingContext', () => {
  test('extracts domain, ext, stemName correctly', () => {
    const ctx = buildRoutingContext(
      'https://www.unsplash.com/photos/abc1234/download?force=true',
      'photo_123.jpg',
      'image',
      'Images',
      'Unsplash Photo'
    );

    expect(ctx.domain).toBe('unsplash.com');
    expect(ctx.ext).toBe('jpg');
    expect(ctx.stemName).toBe('photo_123');
    expect(ctx.filename).toBe('photo_123.jpg');
    expect(ctx.category).toBe('image');
    expect(ctx.categoryFolder).toBe('Images');
    expect(ctx.pageTitle).toBe('Unsplash Photo');
  });

  test('gracefully handles invalid URLs without crashing', () => {
    const ctx = buildRoutingContext('not-a-valid-url', 'test.pdf', 'document', 'Documents');
    expect(ctx.domain).toBe('');
    expect(ctx.ext).toBe('pdf');
    expect(ctx.stemName).toBe('test');
  });
});

describe('RoutingEngine.resolve', () => {
  const rules: RoutingRule[] = [
    {
      id: 'rule-gh',
      name: 'GitHub Releases',
      enabled: true,
      priority: 1,
      conditions: [
        { field: 'domain', op: 'equals', value: 'github.com' },
        { field: 'category', op: 'equals', value: 'archive' },
      ],
      action: 'route_to',
      savePath: 'Code/{domain}/{date}',
      filenameTemplate: '',
    },
    {
      id: 'rule-unsplash',
      name: 'Design Assets',
      enabled: true,
      priority: 2,
      conditions: [
        { field: 'domain', op: 'in', value: 'unsplash.com, pexels.com, figma.com' },
      ],
      action: 'both',
      savePath: 'Design/{domain}',
      filenameTemplate: 'asset_{date}_{original_name}.{ext}',
    },
    {
      id: 'rule-pdf',
      name: 'Research Papers',
      enabled: true,
      priority: 3,
      conditions: [
        { field: 'ext', op: 'equals', value: 'pdf' },
      ],
      action: 'route_to',
      savePath: 'Documents/Research/{year}-{month}',
      filenameTemplate: '',
    },
    {
      id: 'rule-disabled',
      name: 'Disabled Rule',
      enabled: false,
      priority: 0, // lower priority number, but disabled
      conditions: [
        { field: 'domain', op: 'equals', value: 'github.com' },
      ],
      action: 'route_to',
      savePath: 'ShouldNotMatch',
    },
  ];

  const engine = new RoutingEngine(rules);

  test('matches rule-gh with multiple AND conditions', () => {
    const ctx = buildRoutingContext(
      'https://github.com/user/repo/releases/tag/v1.0.zip',
      'v1.0.zip',
      'archive',
      'Archives'
    );
    const result = engine.resolve(ctx);

    expect(result.matchedRule?.id).toBe('rule-gh');
    expect(result.savePath).toContain('Code/github.com/');
    expect(result.filename).toBe(''); // action was route_to
  });

  test('does not match rule-gh when second condition fails (different category)', () => {
    const ctx = buildRoutingContext(
      'https://github.com/user/repo/raw/main/avatar.png',
      'avatar.png',
      'image',
      'Images'
    );
    const result = engine.resolve(ctx);

    expect(result.matchedRule).toBeNull();
    expect(result.savePath).toBe('');
    expect(result.filename).toBe('');
  });

  test('matches rule-unsplash with "in" condition and action "both"', () => {
    const ctx = buildRoutingContext(
      'https://www.pexels.com/download/sunset.jpg',
      'sunset.jpg',
      'image',
      'Images'
    );
    const result = engine.resolve(ctx);

    expect(result.matchedRule?.id).toBe('rule-unsplash');
    expect(result.savePath).toBe('Design/pexels.com');
    expect(result.filename).toContain('asset_');
    expect(result.filename).toContain('sunset.jpg');
  });

  test('matches rule-pdf based on extension', () => {
    const ctx = buildRoutingContext(
      'https://arxiv.org/pdf/2401.0001.pdf',
      'paper.pdf',
      'document',
      'Documents'
    );
    const result = engine.resolve(ctx);

    expect(result.matchedRule?.id).toBe('rule-pdf');
    expect(result.savePath).toContain('Documents/Research/');
  });

  test('ignores disabled rules even with higher priority', () => {
    const ctx = buildRoutingContext(
      'https://github.com/archive.zip',
      'archive.zip',
      'archive',
      'Archives'
    );
    const result = engine.resolve(ctx);
    // rule-disabled has priority 0, but is enabled: false. rule-gh should win.
    expect(result.matchedRule?.id).toBe('rule-gh');
  });

  test('supports regex condition and gracefully handles invalid regex', () => {
    const customEngine = new RoutingEngine([
      {
        id: 'rule-regex-ok',
        name: 'Regex Match',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'url_pattern', op: 'regex', value: 'lecture[0-9]+' },
        ],
        action: 'route_to',
        savePath: 'Lectures',
      },
      {
        id: 'rule-bad-regex',
        name: 'Bad Regex',
        enabled: true,
        priority: 2,
        conditions: [
          { field: 'url_pattern', op: 'regex', value: '[unclosed(bracket' },
        ],
        action: 'route_to',
        savePath: 'BadRegex',
      },
    ]);

    const ctxMatch = buildRoutingContext(
      'https://university.edu/courses/lecture04.mp4',
      'lecture04.mp4',
      'video',
      'Videos'
    );
    expect(customEngine.resolve(ctxMatch).savePath).toBe('Lectures');

    const ctxNoMatch = buildRoutingContext(
      'https://university.edu/courses/intro.mp4',
      'intro.mp4',
      'video',
      'Videos'
    );
    expect(customEngine.resolve(ctxNoMatch).matchedRule).toBeNull();
  });

  test('supports starts_with, ends_with, and contains operators', () => {
    const opsEngine = new RoutingEngine([
      {
        id: 'r1',
        name: 'Starts with',
        enabled: true,
        priority: 1,
        conditions: [{ field: 'filename', op: 'starts_with', value: 'backup_' }],
        action: 'route_to',
        savePath: 'Backups',
      },
      {
        id: 'r2',
        name: 'Ends with',
        enabled: true,
        priority: 2,
        conditions: [{ field: 'domain', op: 'ends_with', value: '.internal' }],
        action: 'route_to',
        savePath: 'Internal',
      },
      {
        id: 'r3',
        name: 'Contains',
        enabled: true,
        priority: 3,
        conditions: [{ field: 'url_pattern', op: 'contains', value: '/drafts/' }],
        action: 'route_to',
        savePath: 'Drafts',
      },
    ]);

    expect(opsEngine.resolve(buildRoutingContext('https://cloud.com/f', 'backup_db.sql', 'archive', 'Archives')).savePath).toBe('Backups');
    expect(opsEngine.resolve(buildRoutingContext('https://prod.internal/file.txt', 'file.txt', 'document', 'Documents')).savePath).toBe('Internal');
    expect(opsEngine.resolve(buildRoutingContext('https://blog.com/drafts/post1', 'post.html', 'document', 'Documents')).savePath).toBe('Drafts');
  });

  test('setRules dynamically updates rules in priority order', () => {
    const dynamicEngine = new RoutingEngine([]);
    expect(dynamicEngine.resolve(buildRoutingContext('https://a.com/b', 'b.txt', 'document', 'Documents')).matchedRule).toBeNull();

    dynamicEngine.setRules([
      {
        id: 'new-rule',
        name: 'Dynamic',
        enabled: true,
        priority: 1,
        conditions: [{ field: 'domain', op: 'equals', value: 'a.com' }],
        action: 'route_to',
        savePath: 'DynamicFolder',
      },
    ]);

    expect(dynamicEngine.resolve(buildRoutingContext('https://a.com/b', 'b.txt', 'document', 'Documents')).savePath).toBe('DynamicFolder');
  });

  test('supports negative operators: not_equals, not_contains, not_in', () => {
    const negEngine = new RoutingEngine([
      {
        id: 'r-neg',
        name: 'Exclude Domains',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'domain', op: 'not_equals', value: 'internal.corp' },
          { field: 'url_pattern', op: 'not_contains', value: '/confidential/' },
          { field: 'ext', op: 'not_in', value: 'exe, bat, cmd' },
        ],
        action: 'route_to',
        savePath: 'SafeDownloads',
      },
    ]);

    // Matches safe download
    const safeCtx = buildRoutingContext('https://example.com/files/report.pdf', 'report.pdf', 'document', 'Documents');
    expect(negEngine.resolve(safeCtx).savePath).toBe('SafeDownloads');

    // Fails because domain equals internal.corp
    const internalCtx = buildRoutingContext('https://internal.corp/files/report.pdf', 'report.pdf', 'document', 'Documents');
    expect(negEngine.resolve(internalCtx).matchedRule).toBeNull();

    // Fails because url contains confidential
    const confCtx = buildRoutingContext('https://example.com/confidential/doc.pdf', 'doc.pdf', 'document', 'Documents');
    expect(negEngine.resolve(confCtx).matchedRule).toBeNull();

    // Fails because extension is in forbidden list
    const exeCtx = buildRoutingContext('https://example.com/setup.exe', 'setup.exe', 'application', 'Software');
    expect(negEngine.resolve(exeCtx).matchedRule).toBeNull();
  });

  test('supports pageTitle and mime field conditions', () => {
    const metaEngine = new RoutingEngine([
      {
        id: 'r-title',
        name: 'Invoice from Title',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'title', op: 'contains', value: 'tax invoice' },
          { field: 'mime', op: 'equals', value: 'application/pdf' },
        ],
        action: 'route_to',
        savePath: 'Invoices',
      },
    ]);

    const ctx = buildRoutingContext(
      'https://billing.provider.com/get?id=99',
      'statement.pdf',
      'document',
      'Documents',
      'Official Tax Invoice #4928 - Acmee Corp',
      undefined,
      'application/pdf'
    );

    expect(metaEngine.resolve(ctx).savePath).toBe('Invoices');
  });

  test('normalizes extension with leading dot and domain with protocol', () => {
    const normEngine = new RoutingEngine([
      {
        id: 'r-norm',
        name: 'Normalized Ext & Domain',
        enabled: true,
        priority: 1,
        conditions: [
          { field: 'domain', op: 'equals', value: 'https://www.github.com/' },
          { field: 'ext', op: 'in', value: '.zip, .tar.gz, .7z' },
        ],
        action: 'route_to',
        savePath: 'Code/Archives',
      },
    ]);

    const ctx = buildRoutingContext('https://github.com/repo/releases/v1.zip', 'v1.zip', 'archive', 'Archives');
    expect(normEngine.resolve(ctx).savePath).toBe('Code/Archives');
  });

  test('safeguards file extension when template omits extension token', () => {
    const renameEngine = new RoutingEngine([
      {
        id: 'r-rename',
        name: 'Omitted Extension Template',
        enabled: true,
        priority: 1,
        conditions: [{ field: 'domain', op: 'equals', value: 'example.com' }],
        action: 'rename',
        filenameTemplate: 'my_custom_filename',
      },
    ]);

    const ctx = buildRoutingContext('https://example.com/dl.pdf', 'dl.pdf', 'document', 'Documents');
    const res = renameEngine.resolve(ctx);
    // Even though user template forgot '.{ext}', engine ensures extension is never lost!
    expect(res.filename).toBe('my_custom_filename.pdf');
  });
});
