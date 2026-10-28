// ============================================================
//  All-Downloader — Dynamic Smart Routing & Path Resolver
//  Combines user-defined rules with the open-ended dynamic
//  semantic classifier across all domains & topics.
// ============================================================

import type { ExtensionSettings, FileCategory } from '../../shared/types.js';
import { RoutingEngine, buildRoutingContext } from './routing-engine.js';
import { classifyDownloadDynamic, type DynamicSemanticClassification } from './semantic-classifier.js';
import { buildSavePath, sanitizeFilename } from './path-sanitizer.js';

export interface SmartRoutingResolution {
  savePath: string;
  filename: string;
  matchedRuleId?: string;
  semantic?: DynamicSemanticClassification;
  smartBadge?: {
    label: string;
    icon: string;
    folder: string;
    shelfKey: string;
  };
}

export interface ResolveOptions {
  url: string;
  filename: string;
  category: FileCategory;
  categoryFolder?: string;
  pageTitle?: string;
  referrer?: string;
  mime?: string;
  settings: ExtensionSettings;
  routingEngine: RoutingEngine;
}

/**
 * Resolves the final destination and filename for a download:
 *  1. Checks custom user-defined routing rules first (highest priority).
 *  2. If no custom rule matches and smart routing is active, applies the selected hierarchy strategy:
 *     - 'contextual': Deep semantic classification (Healthcare, Legal, Engineering, Finance, Academics, etc.).
 *                     Falls back cleanly to standard category folder for generic files if category sorting is enabled.
 *     - 'category': Standard category subfolders (Videos/, Documents/, Images/, etc.).
 *     - 'domain': Domain & year hierarchy ({domain}/{year}).
 *     - 'date': Chronological timeline ({year}/{month}).
 *     - 'flat': Direct to base download subfolder without subdirectories.
 *  3. Seamlessly prefixes the user's Base Download Subfolder (defaultSavePath) across all modes.
 *  4. Global fallback if smart routing is disabled: Base Subfolder + optional category folder.
 */
export function resolveDownloadRoute(options: ResolveOptions): SmartRoutingResolution {
  const {
    url,
    filename,
    category,
    categoryFolder,
    pageTitle,
    referrer,
    mime,
    settings,
    routingEngine,
  } = options;

  let domain = '';
  try {
    domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    domain = '';
  }

  // ── Step 1: User Custom Routing Rules (Highest Priority) ──
  if (settings.enableRoutingRules && (settings.routingRules || []).length > 0) {
    const ctx = buildRoutingContext(url, filename, category, categoryFolder || '', pageTitle, undefined, mime);
    const ruleResult = routingEngine.resolve(ctx);

    if (ruleResult.matchedRule) {
      const resolvedFilename = ruleResult.filename || filename;
      const targetRuleFolder = ruleResult.savePath !== undefined
        ? ruleResult.savePath
        : (settings.organizeByCategoryFolders ? categoryFolder : undefined);

      const resolvedPath = buildSavePath(
        settings.defaultSavePath,
        resolvedFilename,
        targetRuleFolder
      );

      return {
        savePath: resolvedPath,
        filename: resolvedFilename,
        matchedRuleId: ruleResult.matchedRule.id,
      };
    }
  }

  // ── Step 2: Unified Smart Organization & Dynamic Hierarchy ──
  const isSmartRoutingEnabled = settings.enableSmartRouting !== false; // enabled by default
  const structure = settings.smartRoutingStructure || 'contextual';

  if (isSmartRoutingEnabled && structure !== 'flat') {
    const classification = classifyDownloadDynamic({
      url,
      domain,
      filename,
      pageTitle,
      referrer,
    });

    const isHighConfidence = Boolean(classification && classification.confidence >= 0.25);
    const now = new Date();
    const year = classification?.entities?.year || String(now.getFullYear());
    const month = classification?.entities?.month || String(now.getMonth() + 1).padStart(2, '0');

    let targetFolder: string | undefined = undefined;

    if (structure === 'domain') {
      targetFolder = domain ? `${domain}/${year}` : year;
    } else if (structure === 'category') {
      targetFolder = categoryFolder || 'Other';
    } else if (structure === 'date') {
      targetFolder = `${year}/${month}`;
    } else if (structure === 'contextual') {
      if (isHighConfidence && classification?.suggestedSavePath) {
        targetFolder = classification.suggestedSavePath;
      } else {
        // Unified fallback: unclassified generic files cleanly sort into category folder
        targetFolder = categoryFolder || 'Other';
      }
    }

    const shouldClean = settings.smartFilenameClean !== false;
    const targetFilename = (shouldClean && isHighConfidence && classification?.suggestedFilename)
      ? sanitizeFilename(classification.suggestedFilename)
      : filename;

    const resolvedPath = buildSavePath(
      settings.defaultSavePath,
      targetFilename,
      targetFolder
    );

    return {
      savePath: resolvedPath,
      filename: targetFilename,
      semantic: (isHighConfidence && classification) ? classification : undefined,
      smartBadge: isHighConfidence && classification ? {
        label: classification.shelfLabel,
        icon: classification.shelfIcon,
        folder: targetFolder || '',
        shelfKey: classification.shelfKey,
      } : (targetFolder ? {
        label: targetFolder,
        icon: '📁',
        folder: targetFolder,
        shelfKey: targetFolder.toLowerCase(),
      } : undefined),
    };
  }

  // ── Step 3: Global Fallback (Smart Routing Disabled or Flat) ──
  const fallbackFolder = (isSmartRoutingEnabled && structure === 'category') ? categoryFolder : undefined;
  const defaultPath = buildSavePath(settings.defaultSavePath, filename, fallbackFolder);
  return {
    savePath: defaultPath,
    filename,
  };
}
