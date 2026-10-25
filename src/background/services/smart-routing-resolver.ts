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
 *  2. If no custom rule matches and smart routing is active, applies dynamic semantic classification
 *     (Healthcare, Legal, Engineering, Finance, Academics, Automotive, Creative, Work, Govt, Dev).
 *  3. Falls back to global default path and category folder.
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
      const resolvedPath = buildSavePath(
        ruleResult.savePath || settings.defaultSavePath,
        resolvedFilename,
        ruleResult.savePath ? undefined : categoryFolder
      );

      return {
        savePath: resolvedPath,
        filename: resolvedFilename,
        matchedRuleId: ruleResult.matchedRule.id,
      };
    }
  }

  // ── Step 2: Open-Ended Dynamic Semantic Intent Classifier ──
  const isSmartRoutingEnabled = settings.enableSmartRouting !== false; // enabled by default
  if (isSmartRoutingEnabled) {
    const classification = classifyDownloadDynamic({
      url,
      domain,
      filename,
      pageTitle,
      referrer,
    });

    if (classification && classification.confidence >= 0.25) {
      const structure = settings.smartRoutingStructure || 'contextual';
      let targetFolder = classification.suggestedSavePath;

      if (structure === 'domain') {
        const year = classification.entities?.year || String(new Date().getFullYear());
        targetFolder = domain ? `${domain}/${year}` : year;
      } else if (structure === 'category') {
        targetFolder = categoryFolder || 'Other';
      } else if (structure === 'date') {
        const now = new Date();
        const year = String(now.getFullYear());
        const month = String(now.getMonth() + 1).padStart(2, '0');
        targetFolder = `${year}/${month}`;
      }

      const shouldClean = settings.smartFilenameClean !== false;
      const targetFilename = (shouldClean && classification.suggestedFilename)
        ? sanitizeFilename(classification.suggestedFilename)
        : filename;

      const resolvedPath = buildSavePath(
        targetFolder,
        targetFilename,
        undefined // Do not apply generic category subfolder when dynamic path exists
      );

      return {
        savePath: resolvedPath,
        filename: targetFilename,
        semantic: classification,
        smartBadge: {
          label: classification.shelfLabel,
          icon: classification.shelfIcon,
          folder: targetFolder,
          shelfKey: classification.shelfKey,
        },
      };
    }
  }

  // ── Step 3: Global Defaults Fallback ──
  const defaultPath = buildSavePath(settings.defaultSavePath, filename, categoryFolder);
  return {
    savePath: defaultPath,
    filename,
  };
}
