// ============================================================
//  All-Downloader — Smart Directory Routing & Filename Template Engine
//  Evaluates user-defined routing rules against download metadata
//  and expands token-based path/filename templates.
//
//  Architecture:
//    - Rules are evaluated in ascending priority order (lower = first)
//    - ALL conditions within a rule must match (AND semantics)
//    - First matching rule wins; remaining rules are not evaluated
//    - Token expansion is performed on the winning rule's templates
//    - All outputs are safe relative path strings (sanitization happens
//      downstream in path-sanitizer.ts :: buildSavePath)
// ============================================================

import type { RoutingRule, RoutingRuleCondition, RuleConditionField, RuleConditionOp, FileCategory } from '../../shared/types.js';

// ── Token Resolution Context ──────────────────────────────────

export interface RoutingContext {
  /** Original URL of the download */
  url: string;
  /** Cleaned hostname without www prefix, e.g. "github.com" */
  domain: string;
  /** Detected file category */
  category: FileCategory;
  /** Folder name for category, e.g. "Videos", "Archives" */
  categoryFolder: string;
  /** File extension without dot, lowercase, e.g. "mp4" */
  ext: string;
  /** Filename stem without extension, e.g. "lecture_04" */
  stemName: string;
  /** Full filename with extension */
  filename: string;
  /** Page title from referrer tab (optional) */
  pageTitle?: string;
  /** MIME type if known, e.g. "application/pdf" */
  mime?: string;
  /** Image/video resolution string if detected, e.g. "1920×1080" */
  resolution?: string;
}

// ── Resolved Output ───────────────────────────────────────────

export interface RoutingResult {
  /** Expanded save path template, or empty string if no rule matched */
  savePath: string;
  /** Expanded filename template, or empty string if no rule matched */
  filename: string;
  /** The rule that produced this result, or null if no match */
  matchedRule: RoutingRule | null;
}

// ── Condition Evaluator ───────────────────────────────────────

/**
 * Extracts the raw string value for a given rule condition field
 * from the routing context.
 */
function getFieldValue(field: RuleConditionField, ctx: RoutingContext): string {
  switch (field) {
    case 'domain':      return ctx.domain.toLowerCase();
    case 'category':    return ctx.category.toLowerCase();
    case 'url_pattern': return ctx.url.toLowerCase();
    case 'ext':         return ctx.ext.toLowerCase();
    case 'filename':    return ctx.filename.toLowerCase();
    case 'title':       return (ctx.pageTitle || '').toLowerCase();
    case 'mime':        return (ctx.mime || '').toLowerCase();
    default:            return '';
  }
}

/**
 * Evaluates a single condition against the routing context.
 * Returns true if the condition matches.
 */
function evalCondition(cond: RoutingRuleCondition, ctx: RoutingContext): boolean {
  let fieldValue = getFieldValue(cond.field, ctx);
  let condValue  = (cond.value || '').trim().toLowerCase();

  // Smart normalization: if matching extension, strip any leading dots so ".pdf" and "pdf" match seamlessly
  if (cond.field === 'ext') {
    fieldValue = fieldValue.replace(/^\.+/, '');
    condValue  = condValue.replace(/^\.+/, '');
  }

  // Smart normalization: if matching domain, strip protocol, trailing paths, and leading "www."
  if (cond.field === 'domain') {
    condValue = condValue.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').replace(/\/.*$/, '');
  }

  switch (cond.op as RuleConditionOp) {
    case 'equals':
      return fieldValue === condValue;

    case 'not_equals':
      return fieldValue !== condValue;

    case 'contains':
      return fieldValue.includes(condValue);

    case 'not_contains':
      return !fieldValue.includes(condValue);

    case 'starts_with':
      return fieldValue.startsWith(condValue);

    case 'ends_with':
      return fieldValue.endsWith(condValue);

    case 'in': {
      const items = condValue.split(',').map(v => v.trim().replace(/^\.+/, '')).filter(Boolean);
      return items.includes(fieldValue);
    }

    case 'not_in': {
      const items = condValue.split(',').map(v => v.trim().replace(/^\.+/, '')).filter(Boolean);
      return !items.includes(fieldValue);
    }

    case 'regex': {
      if (!cond.value) return false;
      try {
        const re = new RegExp(cond.value.trim(), 'i');
        return re.test(fieldValue);
      } catch {
        console.warn(`[ADL/Routing] Invalid regex pattern: "${cond.value}" — skipping condition`);
        return false;
      }
    }

    default:
      return false;
  }
}

// ── Token Expander ────────────────────────────────────────────

/**
 * Expands all supported token placeholders in a template string
 * using the routing context. Unknown tokens are left as-is.
 *
 * Supported tokens:
 *   {domain}         → ctx.domain          e.g. "sub.example.com"
 *   {site}           → second-level domain  e.g. "example"
 *   {subdomain}      → subdomain if any    e.g. "sub"
 *   {tld}            → last TLD segment     e.g. "com"
 *   {date}           → YYYY-MM-DD           e.g. "2026-10-23"
 *   {time}           → HH-MM-SS             e.g. "14-30-05"
 *   {year}           → 4-digit year         e.g. "2026"
 *   {month}          → 2-digit month        e.g. "10"
 *   {day}            → 2-digit day          e.g. "23"
 *   {quarter}        → quarter              e.g. "Q4"
 *   {timestamp}      → epoch timestamp      e.g. "1792940000000"
 *   {category}       → category folder name e.g. "Videos"
 *   {ext}            → extension w/o dot    e.g. "mp4"
 *   {original_name}  → filename stem        e.g. "lecture_04"
 *   {title}          → page title           e.g. "Advanced_React"
 *   {resolution}     → resolution if known  e.g. "1920x1080"
 */
export function expandTokens(template: string, ctx: RoutingContext): string {
  if (!template) return '';

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  // Extract domain parts
  const domainParts = ctx.domain.split('.');
  const tld = domainParts.length > 1 ? domainParts[domainParts.length - 1] : ctx.domain;
  const site = domainParts.length > 1 ? domainParts[domainParts.length - 2] : ctx.domain;
  const subdomain = domainParts.length > 2 ? domainParts.slice(0, domainParts.length - 2).join('.') : '';

  // Quarter computation: Jan-Mar (Q1), Apr-Jun (Q2), Jul-Sep (Q3), Oct-Dec (Q4)
  const quarter = `Q${Math.floor(now.getMonth() / 3) + 1}`;

  // Sanitize page title for use as a path segment — strip illegal chars
  const safeTitle = (ctx.pageTitle || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80)
    .replace(/^_+|_+$/g, '');

  return template
    .replace(/\{domain\}/g,        ctx.domain)
    .replace(/\{site\}/g,          site)
    .replace(/\{subdomain\}/g,     subdomain)
    .replace(/\{tld\}/g,           tld)
    .replace(/\{date\}/g,          `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    .replace(/\{time\}/g,          `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`)
    .replace(/\{year\}/g,          String(now.getFullYear()))
    .replace(/\{month\}/g,         pad(now.getMonth() + 1))
    .replace(/\{day\}/g,           pad(now.getDate()))
    .replace(/\{quarter\}/g,       quarter)
    .replace(/\{timestamp\}/g,     String(now.getTime()))
    .replace(/\{category\}/g,      ctx.categoryFolder)
    .replace(/\{ext\}/g,           ctx.ext)
    .replace(/\{original_name\}/g, ctx.stemName)
    .replace(/\{title\}/g,         safeTitle)
    .replace(/\{resolution\}/g,    ctx.resolution || '');
}

// ── Path Cleaner ──────────────────────────────────────────────

/**
 * Cleans up a token-expanded path template:
 *  - Collapses consecutive slashes
 *  - Removes leading/trailing slashes
 *  - Strips forbidden filesystem characters (:*?"<>|) per segment
 *  - Removes empty path segments created by empty token expansions
 */
function cleanExpandedPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map(seg => seg.trim().replace(/[:*?"<>|]/g, '_').replace(/^_+|_+$/g, ''))
    .filter(seg => seg !== '' && seg !== '.' && seg !== '..')
    .join('/');
}

// ── Main Engine ───────────────────────────────────────────────

/**
 * Evaluates all enabled routing rules against the download context
 * and returns the first matching rule's expanded paths.
 *
 * If no rule matches, returns empty strings (fallback to global settings).
 */
export class RoutingEngine {
  private rules: RoutingRule[];

  constructor(rules: RoutingRule[]) {
    this.rules = [...rules].sort((a, b) => a.priority - b.priority);
  }

  /** Update rules at runtime (e.g. after settings save) */
  public setRules(rules: RoutingRule[]): void {
    this.rules = [...rules].sort((a, b) => a.priority - b.priority);
  }

  public getRules(): readonly RoutingRule[] {
    return this.rules;
  }

  /**
   * Resolve routing for a download. Evaluates rules in priority order.
   * Returns the first matching rule's output, or empty strings if no match.
   */
  public resolve(ctx: RoutingContext): RoutingResult {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (rule.conditions.length === 0) continue;

      const matches = rule.conditions.every(cond => evalCondition(cond, ctx));
      if (!matches) continue;

      // Rule matched — expand templates
      const rawSavePath  = rule.action !== 'rename'    ? (rule.savePath        || '') : '';
      const rawFilename  = rule.action !== 'route_to'  ? (rule.filenameTemplate || '') : '';

      const expandedSavePath = rawSavePath  ? cleanExpandedPath(expandTokens(rawSavePath, ctx)) : '';
      let expandedFilename = rawFilename  ? expandTokens(rawFilename, ctx).trim() : '';

      // Critical safety: Ensure filename doesn't lose its extension
      if (expandedFilename && ctx.ext) {
        const extPattern = new RegExp(`\\.${ctx.ext}$`, 'i');
        if (!extPattern.test(expandedFilename) && !expandedFilename.includes('.')) {
          expandedFilename = `${expandedFilename}.${ctx.ext}`;
        }
      }

      // Normalize double separators and sanitize forbidden characters in filename
      if (expandedFilename) {
        const dotIdx = expandedFilename.lastIndexOf('.');
        if (dotIdx > 0) {
          const stem = expandedFilename.slice(0, dotIdx)
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/-{2,}/g, '-')
            .replace(/^[-_]+|[-_]+$/g, '');
          const extension = expandedFilename.slice(dotIdx + 1);
          expandedFilename = `${stem || ctx.stemName}.${extension}`;
        } else {
          expandedFilename = expandedFilename
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/-{2,}/g, '-')
            .replace(/^[-_]+|[-_]+$/g, '') || ctx.stemName;
        }
      }

      return {
        savePath:    expandedSavePath,
        filename:    expandedFilename,
        matchedRule: rule,
      };
    }

    return { savePath: '', filename: '', matchedRule: null };
  }
}

// ── Context Builder Helper ────────────────────────────────────

/**
 * Builds a RoutingContext from raw download parameters.
 * Used before calling engine.resolve().
 */
export function buildRoutingContext(
  url: string,
  filename: string,
  category: FileCategory,
  categoryFolder: string,
  pageTitle?: string,
  resolution?: string,
  mime?: string,
): RoutingContext {
  let domain = '';
  try {
    domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    domain = '';
  }

  const lastDot = filename.lastIndexOf('.');
  const ext      = lastDot > 0 ? filename.slice(lastDot + 1).toLowerCase() : '';
  const stemName = lastDot > 0 ? filename.slice(0, lastDot) : filename;

  return {
    url,
    domain,
    category,
    categoryFolder,
    ext,
    stemName,
    filename,
    pageTitle,
    resolution,
    mime,
  };
}
