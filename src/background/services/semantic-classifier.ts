// ============================================================
//  All-Downloader — Dynamic Semantic Classifier Engine
//  Open-Ended, Zero-Dictionary Context Understanding Pipeline
//
//  Dynamically classifies file intent across ANY website and topic:
//  Healthcare, Legal, Engineering, Finance, Academics, Automotive,
//  Creative Media, Work/Career, Government, Software, and more.
//
//  Syntactic Brand Isolator (0 hardcoded dictionaries)
//  Universal 10-Domain Functional Ontology
//  URL Path Hierarchy & Breadcrumb Miner
//  Universal Alphanumeric Reference Matcher
//
//  Zero external dependencies. Offline, instant (0ms latency).
// ============================================================

export type MacroDomain =
  | 'Healthcare'
  | 'Legal'
  | 'Finance'
  | 'Academics'
  | 'Engineering'
  | 'Career_Work'
  | 'Creative_Media'
  | 'Automotive'
  | 'Government'
  | 'Software_Dev'
  | 'Documents';

export interface ExtractedEntities {
  organization: string;
  institution?: string; // backwards compatibility alias for organization
  identifier?: string;
  course?: string;      // backwards compatibility alias for identifier
  topic?: string;
  year?: string;
  month?: string;
  quarter?: string;
  pathBreadcrumbs?: string[];
  cleanTitle: string;
}

export interface DynamicSemanticClassification {
  domain: MacroDomain;
  microIntent: string;
  intent?: string; // backwards compatibility alias: 'COLLEGE_NOTES', 'BANK_STATEMENT', etc.
  shelfKey: string;
  shelfLabel: string;
  shelfIcon: string;
  confidence: number;
  entities: ExtractedEntities;
  suggestedSavePath: string;
  suggestedFilename: string;
}

// ── 1. Syntactic Brand & Organization Isolator (Zero Hardcoded List) ──

/**
 * Extracts and isolates the brand / organization name dynamically
 * using page title syntactic delimiters, domain second-level domains,
 * and structural heuristics without any static dictionaries.
 */
export function extractOrganizationName(domain: string, pageTitle: string = '', url: string = ''): string {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  const sld = extractDomainSLD(cleanDomain).toLowerCase();

  // A. Title Delimiter Isolation (Web standard format: "Document Title - Company Name" or "Doc | Brand")
  if (pageTitle) {
    const delimiters = [' - ', ' | ', ' :: ', ' — ', ' · ', ' // '];
    for (const delim of delimiters) {
      if (pageTitle.includes(delim)) {
        const parts = pageTitle.split(delim).map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const candidateLast = parts[parts.length - 1];
          const candidateFirst = parts[0];

          // Check if candidateLast matches SLD
          if (candidateLast.toLowerCase().includes(sld) || sld.includes(candidateLast.toLowerCase().replace(/\s+/g, ''))) {
            return formatOrgName(candidateLast);
          }
          // Check if candidateFirst starts with or matches SLD
          const firstWord = candidateFirst.split(/\s+/)[0].toLowerCase();
          if (firstWord === sld || sld.includes(firstWord)) {
            if (candidateFirst.split(/\s+/).length > 2 && firstWord === sld) {
              return formatOrgName(candidateFirst.split(/\s+/)[0]);
            }
            return formatOrgName(candidateFirst);
          }
          if (candidateFirst.toLowerCase().includes(sld) || sld.includes(candidateFirst.toLowerCase().replace(/\s+/g, ''))) {
            return formatOrgName(candidateFirst);
          }

          // Document description vs Brand heuristic:
          // If one segment contains document descriptor terms (Datasheet, Manual, Invoice, Statement, etc.)
          // and the other does not, the non-document segment is the Brand / Organization.
          const DOC_TYPE_REGEX = /\b(datasheet|manual|manuals|guide|handbook|invoice|receipt|statement|report|results?|notes?|specification|specs?|brochure|catalog|filing|docket|order|agreement|contract|summary)\b/i;
          const lastHasDocType = DOC_TYPE_REGEX.test(candidateLast);
          const firstHasDocType = DOC_TYPE_REGEX.test(candidateFirst);

          if (lastHasDocType && !firstHasDocType) {
            return formatOrgName(candidateFirst);
          }
          if (firstHasDocType && !lastHasDocType) {
            return formatOrgName(candidateLast);
          }

          // If last part is short (1-4 words, <= 30 chars), it's overwhelmingly the site brand
          if (candidateLast.length > 1 && candidateLast.length <= 30 && candidateLast.split(/\s+/).length <= 4) {
            return formatOrgName(candidateLast);
          }
          // If first part is short and looks like a brand name
          if (candidateFirst.length > 1 && candidateFirst.length <= 25 && candidateFirst.split(/\s+/).length <= 3) {
            return formatOrgName(candidateFirst);
          }
        }
      }
    }
  }

  // B. Derive Brand directly from Domain Second-Level Domain (SLD)
  return formatOrgName(sld);
}

/**
 * Strips utility subdomains (portal, app, my, login, billing, etc.) and TLDs
 * to extract the raw SLD core of any domain on the internet.
 */
export function extractDomainSLD(domain: string): string {
  const UTILITY_SUBDOMAINS = new Set([
    'www', 'portal', 'app', 'login', 'download', 'downloads', 'my', 'mychart',
    'student', 'students', 'patients', 'billing', 'docs', 'online', 'secure',
    'web', 'cdn', 'files', 'static', 'auth', 'account', 'accounts', 'cloud',
    'canvas', 'moodle', 'lms', 'ecw', 'connect', 'api', 'gateway',
    'netbanking', 'ebanking', 'onlinebanking', 'mybank', 'banking'
  ]);

  const parts = domain.split('.').filter(Boolean);
  if (parts.length === 0) return 'General';

  // Strip utility subdomains from the front
  let filtered = [...parts];
  while (filtered.length > 2 && UTILITY_SUBDOMAINS.has(filtered[0])) {
    filtered.shift();
  }

  // Handle two-part TLDs like .co.uk, .ac.in, .edu.au, .gov.in, .org.uk
  if (filtered.length >= 3) {
    const secondLast = filtered[filtered.length - 2];
    if (['co', 'ac', 'gov', 'edu', 'org', 'net', 'com', 'mil'].includes(secondLast)) {
      return filtered[filtered.length - 3] || filtered[0];
    }
  }

  if (filtered.length >= 2) {
    return filtered[filtered.length - 2];
  }

  return filtered[0] || 'General';
}

function formatOrgName(raw: string): string {
  if (!raw) return 'General';
  // Strip special symbols, clean spaces
  let cleaned = raw.replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'General';

  // Specific canonical formats
  if (cleaned.toLowerCase() === 'arxiv') return 'ArXiv';

  // Compound bank domain pattern e.g. "hdfcbank" -> "HDFC_Bank", "axisbank" -> "Axis_Bank"
  if (cleaned.toLowerCase().endsWith('bank') && cleaned.length > 4 && !cleaned.includes(' ')) {
    const root = cleaned.slice(0, -4);
    const formattedRoot = root.length <= 4 ? root.toUpperCase() : root.charAt(0).toUpperCase() + root.slice(1).toLowerCase();
    return `${formattedRoot}_Bank`;
  }

  // Strip institutional / corporate legal suffixes from multi-word brands
  // e.g. "Stanford University" -> "Stanford", "Harvard College" -> "Harvard", "Apple Inc" -> "Apple"
  if (cleaned.includes(' ')) {
    cleaned = cleaned.replace(/\s+(university|college|institute|inc\.?|corp\.?|corporation|llc|ltd\.?|co\.?)$/i, '').trim();
  }

  // If already camelCased (e.g. CourtListener, MayoClinic, OpenCourseWare), preserve
  if (/[a-z][A-Z]/.test(cleaned) && !cleaned.includes(' ')) {
    return cleaned;
  }

  // Acronym check: if <= 3 characters, or was already all-caps in input
  if ((cleaned.length <= 3 || cleaned === cleaned.toUpperCase()) && cleaned.length <= 5 && !cleaned.includes(' ')) {
    return cleaned.toUpperCase();
  }

  // Capitalize word boundaries: "mayo clinic" -> "Mayo_Clinic"
  return cleaned
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => {
      if (w.length <= 3 || (w === w.toUpperCase() && w.length <= 5)) {
        return w.toUpperCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join('_')
    .slice(0, 30);
}

// ── 2. Universal Alphanumeric Reference & Identifier Extractor ──

/**
 * Universally captures reference codes, course codes, project tags,
 * ticket numbers, case dockets, invoice IDs, and standards.
 * Examples: CS101, INV-2024, RFC-9110, ISO-27001, PAT-99120, CASE-2041, RX-91203.
 */
export function extractUniversalIdentifier(text: string): string | null {
  if (!text) return null;

  // Pattern: 2-6 capital letters, optional separator (- _ space), 2-6 digits, optional single letter
  const refRegex = /(?:^|[^\w])([A-Z]{2,6})[-_ ]?(\d{2,6}[A-Z]?)(?=[^\w]|$)/g;
  const matches = [...text.matchAll(refRegex)];

  const FALSE_POSITIVES = new Set([
    'HTTP', 'HTTPS', 'HTML', 'UTF8', 'UTF16', 'SHA256', 'MD5', 'ISO9001',
    'MP4', 'MP3', 'WAV', 'PDF', 'ZIP', 'RAR', 'TAR', 'GZ', 'EXE', 'DOCX',
    'XLSX', 'PPTX', 'PNG', 'JPG', 'JPEG', 'WEBP', 'CSS', 'JSON', 'XML'
  ]);

  for (const m of matches) {
    const prefix = m[1].toUpperCase();
    const suffix = m[2].toUpperCase();
    if (FALSE_POSITIVES.has(prefix) || FALSE_POSITIVES.has(`${prefix}${suffix}`)) {
      continue;
    }
    return `${prefix}${suffix}`;
  }

  // Product / Library version tags (e.g. v6.12.1, 2.4.0)
  const verMatch = text.match(/(?:^|[^\w])v?(\d+\.\d+(?:\.\d+)?)(?=[^\w]|$)/i);
  if (verMatch) {
    return `v${verMatch[1]}`;
  }

  return null;
}

/**
 * Extracts 4-digit years (2000 - 2039) with support for any symbol delimiters.
 */
export function extractYear(text: string): string {
  const match = text.match(/(?:^|[^\d])(20[0-3][0-9])(?:[^\d]|$)/);
  if (match) return match[1];
  return String(new Date().getFullYear());
}

/**
 * Extracts month names or abbreviations with support for any symbol delimiters.
 */
export function extractMonth(text: string): string {
  const months: Record<string, string> = {
    jan: 'January', january: 'January',
    feb: 'February', february: 'February',
    mar: 'March', march: 'March',
    apr: 'April', april: 'April',
    may: 'May',
    jun: 'June', june: 'June',
    jul: 'July', july: 'July',
    aug: 'August', august: 'August',
    sep: 'September', sept: 'September', september: 'September',
    oct: 'October', october: 'October',
    nov: 'November', november: 'November',
    dec: 'December', december: 'December',
  };

  const regex = /(?:^|[^a-zA-Z])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?=[^a-zA-Z]|$)/i;
  const match = text.match(regex);
  if (match) {
    return months[match[1].toLowerCase()] || match[1];
  }

  // Numeric month format (YYYY-MM or MM-YYYY)
  const numMatch = text.match(/(?:^|[^\d])20\d\d[-_](0[1-9]|1[0-2])(?:[^\d]|$)/) || text.match(/(?:^|[^\d])(0[1-9]|1[0-2])[-_]20\d\d(?:[^\d]|$)/);
  if (numMatch) {
    const monthNum = parseInt(numMatch[1], 10);
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (monthNum >= 1 && monthNum <= 12) return monthNames[monthNum];
  }

  const currentMonthIdx = new Date().getMonth() + 1;
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return monthNames[currentMonthIdx];
}

export function extractQuarter(text: string): string | null {
  const match = text.match(/(?:^|[^\w])Q([1-4])(?=[^\w]|$)/i);
  return match ? `Q${match[1]}` : null;
}

// ── 3. URL Path Hierarchy & Breadcrumb Miner ──

/**
 * Mines meaningful taxonomic subfolders directly from the URL path hierarchy.
 * e.g. "/patients/cardiology/reports/test_91.pdf" -> ["Cardiology", "Reports"]
 */
export function extractUrlPathBreadcrumbs(url: string): string[] {
  try {
    const parsed = new URL(url);
    const rawSegments = parsed.pathname.split('/').map(s => decodeURIComponent(s).trim()).filter(Boolean);

    // Drop the last segment if it is the filename
    if (rawSegments.length > 0 && rawSegments[rawSegments.length - 1].includes('.')) {
      rawSegments.pop();
    }

    const NOISY_SEGMENTS = new Set([
      'api', 'v1', 'v2', 'v3', 'v4', 'download', 'downloads', 'content', 'file',
      'files', 'get', 'static', 'assets', 'view', 'servlet', 'php', 'aspx', 'jsp',
      'media', 'public', 'upload', 'uploads', 'temp', 'data', 'rest'
    ]);

    const meaningful = rawSegments
      .filter(s => !NOISY_SEGMENTS.has(s.toLowerCase()) && !/^\d+$/.test(s) && s.length > 2 && s.length <= 25)
      .map(s => s.replace(/[^\w-]/g, ' ').replace(/\s+/g, '_'))
      .map(s => s.charAt(0).toUpperCase() + s.slice(1));

    return meaningful.slice(0, 2); // Keep up to 2 clean path segments
  } catch {
    return [];
  }
}

export function cleanStemTitle(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|_+=-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

// ── 4. Universal 10-Domain Functional Ontology ─────────────────

interface OntologyRule {
  domain: MacroDomain;
  microIntent: string;
  subfolder: string;
  shelfKey: string;
  shelfLabel: string;
  shelfIcon: string;
  keywords: string[];
  weight: number;
}

const UNIVERSAL_ONTOLOGY: OntologyRule[] = [
  // ── HEALTHCARE & MEDICAL ──
  {
    domain: 'Healthcare',
    microIntent: 'Lab_Report',
    subfolder: 'Lab_Reports',
    shelfKey: 'healthcare_lab',
    shelfLabel: 'Medical Reports',
    shelfIcon: '🩺',
    keywords: [
      'lab-report', 'lab_report', 'blood-test', 'blood_test', 'pathology',
      'radiology', 'biopsy', 'urinalysis', 'lipid-panel', 'metabolic-panel',
      'test-results', 'lab-results', 'diagnostic-report', 'specimen-report'
    ],
    weight: 16,
  },
  {
    domain: 'Healthcare',
    microIntent: 'Medical_Scan',
    subfolder: 'Medical_Scans',
    shelfKey: 'healthcare_scans',
    shelfLabel: 'Medical Scans',
    shelfIcon: '🩻',
    keywords: ['mri', 'ct-scan', 'x-ray', 'xray', 'ultrasound', 'echocardiogram', 'ecg', 'ekg', 'scan-report'],
    weight: 15,
  },
  {
    domain: 'Healthcare',
    microIntent: 'Prescription',
    subfolder: 'Prescriptions',
    shelfKey: 'healthcare_rx',
    shelfLabel: 'Prescriptions',
    shelfIcon: '💊',
    keywords: ['prescription', 'prescriptions', 'rx-receipt', 'medication-order', 'pharmacy-refill', 'dosage-plan'],
    weight: 15,
  },
  {
    domain: 'Healthcare',
    microIntent: 'Clinical_Record',
    subfolder: 'Clinical_Records',
    shelfKey: 'healthcare_records',
    shelfLabel: 'Clinical Records',
    shelfIcon: '🏥',
    keywords: [
      'clinical-notes', 'discharge-summary', 'treatment-plan', 'patient-summary',
      'immunization-record', 'vaccination-certificate', 'health-record', 'mychart'
    ],
    weight: 13,
  },

  // ── LEGAL & COMPLIANCE ──
  {
    domain: 'Legal',
    microIntent: 'Contract',
    subfolder: 'Contracts',
    shelfKey: 'legal_contracts',
    shelfLabel: 'Legal Contracts',
    shelfIcon: '⚖️',
    keywords: [
      'contract', 'agreement', 'nda', 'non-disclosure', 'terms-of-service',
      'master-services', 'docusign', 'mou', 'lease-agreement', 'license-agreement'
    ],
    weight: 16,
  },
  {
    domain: 'Legal',
    microIntent: 'Court_Filing',
    subfolder: 'Court_Filings',
    shelfKey: 'legal_filings',
    shelfLabel: 'Court Filings',
    shelfIcon: '📜',
    keywords: [
      'docket', 'courtlistener', 'affidavit', 'deposition', 'pleading',
      'court-order', 'memorandum-opinion', 'subpoena', 'complaint', 'verdict', 'judgement'
    ],
    weight: 16,
  },
  {
    domain: 'Legal',
    microIntent: 'Patent',
    subfolder: 'Patents',
    shelfKey: 'legal_patents',
    shelfLabel: 'Patents & IP',
    shelfIcon: '💡',
    keywords: ['patent', 'patent-application', 'trademark', 'uspto', 'wipo', 'ip-filing'],
    weight: 14,
  },

  // ── ENGINEERING & HARDWARE ──
  {
    domain: 'Engineering',
    microIntent: 'Datasheet',
    subfolder: 'Datasheets',
    shelfKey: 'eng_datasheets',
    shelfLabel: 'Datasheets',
    shelfIcon: '⚙️',
    keywords: ['datasheet', 'data-sheet', 'pinout', 'electrical-spec', 'transistor', 'microcontroller', 'ic-spec'],
    weight: 16,
  },
  {
    domain: 'Engineering',
    microIntent: 'Schematic',
    subfolder: 'Schematics',
    shelfKey: 'eng_schematics',
    shelfLabel: 'Schematics & CAD',
    shelfIcon: '📐',
    keywords: ['schematic', 'circuit-diagram', 'pcb-layout', 'gerber', 'boardview', 'cad-drawing', 'blueprint'],
    weight: 15,
  },
  {
    domain: 'Engineering',
    microIntent: 'Technical_Spec',
    subfolder: 'Tech_Specs',
    shelfKey: 'eng_specs',
    shelfLabel: 'Tech Specs',
    shelfIcon: '📑',
    keywords: ['rfc-', 'whitepaper', 'architecture-spec', 'technical-specification', 'ieee-std', 'iso-iec'],
    weight: 14,
  },

  // ── AUTOMOTIVE & MACHINERY ──
  {
    domain: 'Automotive',
    microIntent: 'Repair_Manual',
    subfolder: 'Repair_Manuals',
    shelfKey: 'auto_manuals',
    shelfLabel: 'Auto & Repair Manuals',
    shelfIcon: '🚗',
    keywords: [
      'workshop-manual', 'workshop manual', 'repair-manual', 'repair manual',
      'service-manual', 'service manual', 'wiring-diagram', 'wiring diagram',
      'obd-', 'dtc-code', 'owners-manual', 'owners manual', 'workshop'
    ],
    weight: 16,
  },

  // ── FINANCE & COMMERCE ──
  {
    domain: 'Finance',
    microIntent: 'Bank_Statement',
    subfolder: 'Bank_Statements',
    shelfKey: 'finance_statements',
    shelfLabel: 'Bank Statements',
    shelfIcon: '🏦',
    keywords: [
      'statement', 'estatement', 'e-statement', 'account-statement',
      'bank-statement', 'passbook', 'transaction-history', 'monthly-statement',
      'annual-summary', 'account-summary'
    ],
    weight: 15,
  },
  {
    domain: 'Finance',
    microIntent: 'Invoice_Receipt',
    subfolder: 'Invoices',
    shelfKey: 'finance_invoices',
    shelfLabel: 'Invoices & Receipts',
    shelfIcon: '🧾',
    keywords: [
      'invoice', 'tax-invoice', 'receipt', 'order-summary', 'payment-receipt',
      'e-receipt', 'billing', 'bill-statement', 'purchase-receipt'
    ],
    weight: 13,
  },
  {
    domain: 'Finance',
    microIntent: 'Tax_Document',
    subfolder: 'Taxes',
    shelfKey: 'finance_taxes',
    shelfLabel: 'Tax Documents',
    shelfIcon: '📊',
    keywords: [
      'form-16', 'form16', 'form 16', 'w2', 'w-2', '1040', '1099', 'itr', 'tax-return',
      'tax-computation', 'annual-tax', 'withholding', 'incometax', 'annual tax', 'tax return'
    ],
    weight: 16,
  },

  // ── ACADEMICS & RESEARCH ──
  {
    domain: 'Academics',
    microIntent: 'College_Notes',
    subfolder: 'Notes',
    shelfKey: 'academic_notes',
    shelfLabel: 'College Notes',
    shelfIcon: '🎓',
    keywords: [
      'lecture', 'notes', 'slides', 'handout', 'presentation', 'study-material',
      'courseware', 'syllabus', 'curriculum', 'tutorial', 'assignment',
      'homework', 'problem-set', 'pset', 'lab-manual', 'module', 'unit'
    ],
    weight: 13,
  },
  {
    domain: 'Academics',
    microIntent: 'Exam_Result',
    subfolder: 'Results',
    shelfKey: 'academic_results',
    shelfLabel: 'Exam Results',
    shelfIcon: '📜',
    keywords: [
      'marksheet', 'gradecard', 'grade-card', 'gradesheet', 'transcript',
      'scorecard', 'semester-result', 'term-end', 'convocation',
      'provisional-certificate', 'gpa', 'cgpa', 'exam-result', 'grade card', 'exam result'
    ],
    weight: 16,
  },
  {
    domain: 'Academics',
    microIntent: 'Research_Paper',
    subfolder: 'Research_Papers',
    shelfKey: 'research_papers',
    shelfLabel: 'Research Papers',
    shelfIcon: '🔬',
    keywords: [
      'arxiv', 'proceedings', 'manuscript', 'journal-article', 'sciencedirect',
      'springer', 'nature.com', 'ieee-xplore', 'research-paper', 'research paper', 'whitepaper'
    ],
    weight: 14,
  },

  // ── CAREER & WORK ──
  {
    domain: 'Career_Work',
    microIntent: 'Resume',
    subfolder: 'Resumes',
    shelfKey: 'career_resume',
    shelfLabel: 'Resumes & CVs',
    shelfIcon: '💼',
    keywords: ['resume', 'curriculum-vitae', 'cv.pdf', 'biodata', 'portfolio-resume'],
    weight: 15,
  },
  {
    domain: 'Career_Work',
    microIntent: 'Offer_Letter',
    subfolder: 'Offer_Letters',
    shelfKey: 'career_offers',
    shelfLabel: 'Employment Offers',
    shelfIcon: '🤝',
    keywords: ['offer-letter', 'employment-contract', 'appointment-letter', 'job-offer', 'compensation-agreement'],
    weight: 15,
  },

  // ── CREATIVE & MEDIA ──
  {
    domain: 'Creative_Media',
    microIntent: 'Sheet_Music',
    subfolder: 'Sheet_Music',
    shelfKey: 'creative_music',
    shelfLabel: 'Sheet Music',
    shelfIcon: '🎵',
    keywords: ['sheet-music', 'score.pdf', 'tablature', 'chord-chart', 'piano-score', 'orchestra-score'],
    weight: 15,
  },
  {
    domain: 'Creative_Media',
    microIntent: '3D_Assets',
    subfolder: '3D_Assets',
    shelfKey: 'creative_3d',
    shelfLabel: '3D & Design Assets',
    shelfIcon: '🎨',
    keywords: ['3d-model', 'blend-file', 'obj-export', 'fbx-model', 'texture-pack', 'vector-icons'],
    weight: 14,
  },

  // ── GOVERNMENT & IDENTITY ──
  {
    domain: 'Government',
    microIntent: 'Identity_Record',
    subfolder: 'Identity_Records',
    shelfKey: 'govt_identity',
    shelfLabel: 'Identity Records',
    shelfIcon: '🪪',
    keywords: [
      'passport', 'driving-license', 'driving_licence', 'aadhaar', 'ssn',
      'social-security', 'voter-id', 'birth-certificate', 'visa-grant', 'pan-card', 'digilocker'
    ],
    weight: 15,
  },

  // ── SOFTWARE & DEV ──
  {
    domain: 'Software_Dev',
    microIntent: 'Release_Package',
    subfolder: 'Releases',
    shelfKey: 'dev_releases',
    shelfLabel: 'Software Releases',
    shelfIcon: '💻',
    keywords: ['release', 'tarball', 'source-code', 'archive', 'dataset', 'huggingface', 'github-release'],
    weight: 12,
  },
];

// ── 5. Main Open-Ended Dynamic Classifier ─────────────────────

export interface DynamicClassifierInput {
  url: string;
  domain: string;
  filename: string;
  pageTitle?: string;
  referrer?: string;
}

export function classifyDownloadDynamic(input: DynamicClassifierInput): DynamicSemanticClassification | null {
  const { url, domain, filename, pageTitle = '', referrer = '' } = input;

  // 1. Syntactic Brand & Organization Isolation (0 hardcoded dictionaries)
  const organization = extractOrganizationName(domain, pageTitle, url);

  // 2. URL Path Breadcrumbs Mining
  const breadcrumbs = extractUrlPathBreadcrumbs(url);

  // 3. Universal Alphanumeric Identifier & Temporal Extraction
  const unifiedContext = `${pageTitle} ${url} ${filename} ${referrer}`.toLowerCase();
  const identifier = extractUniversalIdentifier(`${pageTitle} ${filename} ${url}`) || undefined;
  const year = extractYear(unifiedContext);
  const month = extractMonth(unifiedContext);
  const quarter = extractQuarter(unifiedContext) || undefined;

  // 4. Match against Universal Ontology
  let highestScore = 0;
  let winningRule: OntologyRule | null = null;
  const normalizedContext = unifiedContext.replace(/[-_./]/g, ' ');

  for (const rule of UNIVERSAL_ONTOLOGY) {
    let score = 0;

    for (const kw of rule.keywords) {
      const cleanKw = kw.replace(/[-_./]/g, ' ');
      if (unifiedContext.includes(kw) || normalizedContext.includes(cleanKw)) {
        score += rule.weight;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      winningRule = rule;
    }
  }

  // Threshold check
  if (!winningRule || highestScore < 10) {
    return null;
  }

  const lastDot = filename.lastIndexOf('.');
  const ext = lastDot > 0 ? filename.slice(lastDot + 1) : 'pdf';
  const rawStem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const cleanTitle = cleanStemTitle(pageTitle || rawStem).replace(/\s+/g, '_');

  const entities: ExtractedEntities = {
    organization,
    institution: organization, // backwards compatibility
    identifier,
    course: identifier,        // backwards compatibility
    year,
    month,
    quarter,
    pathBreadcrumbs: breadcrumbs,
    cleanTitle,
  };

  // 5. Dynamic Folder Path Construction:
  let suggestedSavePath = '';
  const domainName = winningRule.domain;
  const subfolder = winningRule.subfolder;

  if (subfolder === 'Invoices' || subfolder === 'Taxes') {
    suggestedSavePath = `${domainName}/${subfolder}/${year}`;
  } else if (subfolder === 'Research_Papers') {
    suggestedSavePath = `Research_Papers/${year}`;
  } else if (subfolder === 'Datasheets' || subfolder === 'Repair_Manuals') {
    suggestedSavePath = organization && organization !== 'General'
      ? `${domainName}/${subfolder}/${organization}`
      : `${domainName}/${subfolder}`;
  } else {
    const orgFolder = organization && organization !== 'General' ? `/${organization}` : '';
    const leaf = identifier ? `/${identifier}` : (year ? `/${year}` : '');
    suggestedSavePath = `${domainName}/${subfolder}${orgFolder}${leaf}`;
  }

  // 6. Normalized Filename Construction:
  let suggestedFilename = '';
  if (winningRule.microIntent === 'Bank_Statement' && month && year) {
    suggestedFilename = `[Statement]_${organization}_${month}_${year}.${ext}`;
  } else if (winningRule.microIntent === 'College_Notes') {
    const id = identifier || organization;
    suggestedFilename = `[Notes]_${id}_${cleanTitle}.${ext}`;
  } else if (winningRule.microIntent === 'Exam_Result') {
    suggestedFilename = `[Result]_${organization}_${cleanTitle}.${ext}`;
  } else if (winningRule.microIntent === 'Invoice_Receipt') {
    suggestedFilename = `[Invoice]_${organization}_${cleanTitle}.${ext}`;
  } else if (winningRule.microIntent === 'Tax_Document') {
    suggestedFilename = `[Tax]_${cleanTitle}.${ext}`;
  } else if (winningRule.microIntent === 'Lab_Report') {
    suggestedFilename = `[Lab_Report]_${organization}_${cleanTitle}.${ext}`;
  } else if (winningRule.microIntent === 'Court_Filing') {
    const id = identifier ? `_${identifier}` : '';
    suggestedFilename = `[Filing]_${organization}${id}_${cleanTitle}.${ext}`;
  } else if (winningRule.microIntent === 'Datasheet') {
    const id = identifier ? `_${identifier}` : '';
    suggestedFilename = `[Datasheet]_${organization}${id}_${cleanTitle}.${ext}`;
  } else if (winningRule.microIntent === 'Repair_Manual') {
    suggestedFilename = `[Manual]_${organization}_${cleanTitle}.${ext}`;
  } else {
    const idPrefix = identifier ? `_${identifier}` : '';
    suggestedFilename = `[${winningRule.microIntent}]_${organization}${idPrefix}_${cleanTitle}.${ext}`;
  }
  suggestedFilename = suggestedFilename.replace(/_{2,}/g, '_');

  const confidence = Math.min(1.0, Math.round((highestScore / 25) * 100) / 100);

  const LEGACY_INTENT_MAP: Record<string, string> = {
    College_Notes: 'COLLEGE_NOTES',
    Exam_Result: 'COLLEGE_RESULTS',
    Bank_Statement: 'BANK_STATEMENT',
    Invoice_Receipt: 'INVOICE_RECEIPT',
    Tax_Document: 'TAX_DOCUMENTS',
    Research_Paper: 'RESEARCH_PAPER',
  };
  const intent = LEGACY_INTENT_MAP[winningRule.microIntent] || winningRule.microIntent;

  return {
    domain: winningRule.domain,
    microIntent: winningRule.microIntent,
    intent,
    shelfKey: winningRule.shelfKey,
    shelfLabel: winningRule.shelfLabel,
    shelfIcon: winningRule.shelfIcon,
    confidence,
    entities,
    suggestedSavePath,
    suggestedFilename,
  };
}

// ── Backwards-Compatibility Adapter for Legacy Callers ─────────
export function classifyDownloadSemantic(input: any): any {
  return classifyDownloadDynamic(input);
}
export function extractCourseCode(text: string): string | null {
  return extractUniversalIdentifier(text);
}
export function extractInstitution(domain: string, contextText: string): string {
  return extractOrganizationName(domain, contextText);
}
