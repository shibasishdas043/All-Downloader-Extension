import { describe, it, expect } from 'vitest';
import {
  classifyDownloadSemantic,
  classifyDownloadDynamic,
  extractCourseCode,
  extractUniversalIdentifier,
  extractYear,
  extractMonth,
  extractInstitution,
  extractOrganizationName,
  extractUrlPathBreadcrumbs,
} from '../../src/background/services/semantic-classifier.js';
import {
  resolveDownloadRoute,
} from '../../src/background/services/smart-routing-resolver.js';
import { RoutingEngine } from '../../src/background/services/routing-engine.js';
import { DEFAULT_SETTINGS } from '../../src/shared/constants.js';

describe('Semantic Classifier Engine', () => {
  describe('Entity Extractors', () => {
    it('extracts academic course codes accurately', () => {
      expect(extractCourseCode('Lecture 4: CS101 Introduction to CS')).toBe('CS101');
      expect(extractCourseCode('MATH-201 Calculus Notes Unit 3')).toBe('MATH201');
      expect(extractCourseCode('PHYS 102 Mechanics Homework 2')).toBe('PHYS102');
      expect(extractCourseCode('Advanced ECE-305B Lab Manual')).toBe('ECE305B');
    });

    it('filters out non-course false positives (e.g. HTTP, MP4, SHA256)', () => {
      expect(extractCourseCode('error-http404-report.pdf')).toBeNull();
      expect(extractCourseCode('sample_video_mp4_1080.mp4')).toBeNull();
      expect(extractCourseCode('checksum_sha256_verify.txt')).toBeNull();
    });

    it('extracts years and months', () => {
      expect(extractYear('report_2025_annual.pdf')).toBe('2025');
      expect(extractYear('Fall Semester 2026 Grade Card')).toBe('2026');
      expect(extractMonth('HDFC Bank Statement August 2026')).toBe('August');
      expect(extractMonth('statement_jan_2026.pdf')).toBe('January');
      expect(extractMonth('2026-09-statement.pdf')).toBe('September');
    });

    it('extracts known institutions and brands from domains', () => {
      expect(extractInstitution('canvas.mit.edu', '')).toBe('MIT');
      expect(extractInstitution('netbanking.hdfcbank.com', '')).toBe('HDFC_Bank');
      expect(extractInstitution('chase.com', '')).toBe('Chase');
      expect(extractInstitution('arxiv.org', '')).toBe('ArXiv');
      expect(extractInstitution('stanford.edu', '')).toBe('Stanford');
    });
  });

  describe('Contextual Intent Classification', () => {
    it('classifies college lecture notes into Academics/Notes with course code', () => {
      const res = classifyDownloadSemantic({
        url: 'https://canvas.mit.edu/courses/1802/files/lecture04_notes.pdf',
        domain: 'canvas.mit.edu',
        filename: 'lecture04_notes.pdf',
        pageTitle: 'MIT CS101 Lecture 4 - Recursion & Algorithmic Complexity',
      });

      expect(res).not.toBeNull();
      expect(res?.intent).toBe('COLLEGE_NOTES');
      expect(res?.shelfKey).toBe('academic_notes');
      expect(res?.shelfLabel).toBe('College Notes');
      expect(res?.entities.institution).toBe('MIT');
      expect(res?.entities.course).toBe('CS101');
      expect(res?.suggestedSavePath).toBe('Academics/Notes/MIT/CS101');
      expect(res?.suggestedFilename).toContain('[Notes]_CS101');
    });

    it('classifies exam results / marksheets into Academics/Results', () => {
      const res = classifyDownloadSemantic({
        url: 'https://student.stanford.edu/portal/download_marksheet_servlet?id=89231',
        domain: 'student.stanford.edu',
        filename: 'download_marksheet_servlet.pdf',
        pageTitle: 'Stanford University - Fall 2026 Semester Grade Card & Exam Result',
      });

      expect(res).not.toBeNull();
      expect(res?.intent).toBe('COLLEGE_RESULTS');
      expect(res?.shelfKey).toBe('academic_results');
      expect(res?.shelfLabel).toBe('Exam Results');
      expect(res?.suggestedSavePath).toBe('Academics/Results/Stanford/2026');
      expect(res?.suggestedFilename).toContain('[Result]_Stanford');
    });

    it('classifies bank statements into Finance/Bank_Statements', () => {
      const res = classifyDownloadSemantic({
        url: 'https://netbanking.hdfcbank.com/portal/download?doc=estatement_aug26.pdf',
        domain: 'netbanking.hdfcbank.com',
        filename: 'estatement_aug26.pdf',
        pageTitle: 'HDFC Bank - Account Monthly e-Statement August 2026',
      });

      expect(res).not.toBeNull();
      expect(res?.intent).toBe('BANK_STATEMENT');
      expect(res?.shelfKey).toBe('finance_statements');
      expect(res?.shelfLabel).toBe('Bank Statements');
      expect(res?.suggestedSavePath).toBe('Finance/Bank_Statements/HDFC_Bank/2026');
      expect(res?.suggestedFilename).toBe('[Statement]_HDFC_Bank_August_2026.pdf');
    });

    it('classifies invoices & receipts into Finance/Invoices', () => {
      const res = classifyDownloadSemantic({
        url: 'https://www.amazon.com/gp/css/summary/print.html/ref=ppx_yo_dt_b_invoice',
        domain: 'amazon.com',
        filename: 'order_invoice_402.pdf',
        pageTitle: 'Amazon.com - Order Summary & Tax Invoice 402-9812481',
      });

      expect(res).not.toBeNull();
      expect(res?.intent).toBe('INVOICE_RECEIPT');
      expect(res?.shelfKey).toBe('finance_invoices');
      expect(res?.shelfLabel).toBe('Invoices & Receipts');
      expect(res?.suggestedSavePath).toMatch(/Finance\/Invoices\/\d{4}/);
      expect(res?.suggestedFilename).toContain('[Invoice]_Amazon');
    });

    it('classifies tax documents into Finance/Taxes', () => {
      const res = classifyDownloadSemantic({
        url: 'https://incometax.gov.in/downloads/Form-16_Annual_Tax_Return_2026.pdf',
        domain: 'incometax.gov.in',
        filename: 'Form-16_Annual_Tax_Return_2026.pdf',
        pageTitle: 'Income Tax Department - Form 16 Annual Tax Computation',
      });

      expect(res).not.toBeNull();
      expect(res?.intent).toBe('TAX_DOCUMENTS');
      expect(res?.shelfKey).toBe('finance_taxes');
      expect(res?.shelfLabel).toBe('Tax Documents');
      expect(res?.suggestedSavePath).toBe('Finance/Taxes/2026');
      expect(res?.suggestedFilename).toContain('[Tax]');
    });

    it('classifies research papers into Research_Papers', () => {
      const res = classifyDownloadSemantic({
        url: 'https://arxiv.org/pdf/2401.00001.pdf',
        domain: 'arxiv.org',
        filename: '2401.00001.pdf',
        pageTitle: 'Attention Is All You Need - Transformer Research Paper',
      });

      expect(res).not.toBeNull();
      expect(res?.intent).toBe('RESEARCH_PAPER');
      expect(res?.shelfKey).toBe('research_papers');
      expect(res?.shelfLabel).toBe('Research Papers');
      expect(res?.suggestedSavePath).toMatch(/Research_Papers\/\d{4}/);
    });
  });

  describe('Route Resolution Precedence & User Overrides', () => {
    it('prioritizes user custom routing rule over semantic classification', () => {
      const routingEngine = new RoutingEngine([
        {
          id: 'custom-mit-rule',
          name: 'My Custom MIT Folder',
          enabled: true,
          priority: 1,
          conditions: [
            { field: 'domain', op: 'contains', value: 'mit.edu' },
          ],
          action: 'route_to',
          savePath: 'Custom_Uni/MIT_Special',
        },
      ]);

      const res = resolveDownloadRoute({
        url: 'https://canvas.mit.edu/courses/1802/lecture4_notes.pdf',
        filename: 'lecture4_notes.pdf',
        category: 'document',
        pageTitle: 'MIT CS101 Lecture Notes',
        settings: {
          ...DEFAULT_SETTINGS,
          enableRoutingRules: true,
          enableSmartRouting: true,
          routingRules: routingEngine.getRules() as any,
        },
        routingEngine,
      });

      expect(res.matchedRuleId).toBe('custom-mit-rule');
      expect(res.savePath).toBe('Custom_Uni/MIT_Special/lecture4_notes.pdf');
    });

    it('applies semantic classification when no custom rule matches', () => {
      const routingEngine = new RoutingEngine([]);
      const res = resolveDownloadRoute({
        url: 'https://chase.com/statements/october_2026.pdf',
        filename: 'october_2026.pdf',
        category: 'document',
        pageTitle: 'Chase Bank Account Monthly Statement October 2026',
        settings: {
          ...DEFAULT_SETTINGS,
          enableRoutingRules: false,
          enableSmartRouting: true,
        },
        routingEngine,
      });

      expect(res.semantic?.intent).toBe('BANK_STATEMENT');
      expect(res.smartBadge?.label).toBe('Bank Statements');
      expect(res.smartBadge?.folder).toBe('Finance/Bank_Statements/Chase/2026');
      expect(res.savePath).toBe('Finance/Bank_Statements/Chase/2026/[Statement]_Chase_October_2026.pdf');
    });

    it('falls back to default save path when smart routing is disabled', () => {
      const routingEngine = new RoutingEngine([]);
      const res = resolveDownloadRoute({
        url: 'https://chase.com/statements/october_2026.pdf',
        filename: 'october_2026.pdf',
        category: 'document',
        pageTitle: 'Chase Bank Account Monthly Statement October 2026',
        settings: {
          ...DEFAULT_SETTINGS,
          enableRoutingRules: false,
          enableSmartRouting: false,
        },
        routingEngine,
      });

      expect(res.semantic).toBeUndefined();
      expect(res.savePath).toBe('october_2026.pdf');
    });
  });

  describe('Syntactic Zero-Dictionary Brand Isolator', () => {
    it('isolates brands via delimiter splitting without hardcoded dictionaries', () => {
      expect(extractOrganizationName('portal.mayoclinic.org', 'Blood Test Results - Mayo Clinic')).toBe('Mayo_Clinic');
      expect(extractOrganizationName('courtlistener.com', 'Federal Docket 2041 | CourtListener')).toBe('CourtListener');
      expect(extractOrganizationName('techinfo.toyota.com', 'Toyota Motor Sales — Service Manual')).toBe('Toyota');
      expect(extractOrganizationName('ti.com', 'Texas Instruments :: TMS320F28379D Datasheet')).toBe('Texas_Instruments');
      expect(extractOrganizationName('docusign.net', 'Master Services Agreement // DocuSign')).toBe('DocuSign');
    });

    it('strips institutional and legal suffixes cleanly', () => {
      expect(extractOrganizationName('student.stanford.edu', 'Stanford University - Fall 2026 Semester')).toBe('Stanford');
      expect(extractOrganizationName('harvard.edu', 'Harvard College - Syllabus')).toBe('Harvard');
    });

    it('extracts compound bank brands and short acronyms', () => {
      expect(extractOrganizationName('netbanking.hdfcbank.com', '')).toBe('HDFC_Bank');
      expect(extractOrganizationName('chase.com', '')).toBe('Chase');
      expect(extractOrganizationName('mit.edu', '')).toBe('MIT');
    });
  });

  describe('URL Path Breadcrumb Miner', () => {
    it('mines taxonomic subfolders from clean URL paths', () => {
      const crumbs = extractUrlPathBreadcrumbs('https://example.com/patients/cardiology/reports/test_91.pdf');
      expect(crumbs).toEqual(['Patients', 'Cardiology']);
    });

    it('filters out noisy segments (api, v1, temp, downloads, ids)', () => {
      const crumbs = extractUrlPathBreadcrumbs('https://example.com/api/v1/download/temp/401/file.pdf');
      expect(crumbs).toEqual([]);
    });
  });

  describe('Open-Ended Multi-Domain Semantic Classification', () => {
    it('classifies Healthcare Lab Reports into Healthcare/Lab_Reports', () => {
      const res = classifyDownloadDynamic({
        url: 'https://portal.mayoclinic.org/patients/lab/results/blood_test_2026.pdf',
        domain: 'portal.mayoclinic.org',
        filename: 'blood_test_2026.pdf',
        pageTitle: 'Mayo Clinic - Patient Blood Test & Lipid Panel Results 2026',
      });

      expect(res).not.toBeNull();
      expect(res?.domain).toBe('Healthcare');
      expect(res?.microIntent).toBe('Lab_Report');
      expect(res?.shelfKey).toBe('healthcare_lab');
      expect(res?.shelfLabel).toBe('Medical Reports');
      expect(res?.entities.organization).toBe('Mayo_Clinic');
      expect(res?.suggestedSavePath).toBe('Healthcare/Lab_Reports/Mayo_Clinic/2026');
      expect(res?.suggestedFilename).toContain('[Lab_Report]_Mayo_Clinic');
    });

    it('classifies Legal Court Filings with docket identifier into Legal/Court_Filings', () => {
      const res = classifyDownloadDynamic({
        url: 'https://www.courtlistener.com/docket/2041/download/order.pdf',
        domain: 'courtlistener.com',
        filename: 'order.pdf',
        pageTitle: 'CASE-2041 Memorandum Opinion & Order - CourtListener',
      });

      expect(res).not.toBeNull();
      expect(res?.domain).toBe('Legal');
      expect(res?.microIntent).toBe('Court_Filing');
      expect(res?.shelfKey).toBe('legal_filings');
      expect(res?.shelfLabel).toBe('Court Filings');
      expect(res?.entities.organization).toBe('CourtListener');
      expect(res?.entities.identifier).toBe('CASE2041');
      expect(res?.suggestedSavePath).toBe('Legal/Court_Filings/CourtListener/CASE2041');
      expect(res?.suggestedFilename).toContain('[Filing]_CourtListener');
    });

    it('classifies Engineering Datasheets into Engineering/Datasheets', () => {
      const res = classifyDownloadDynamic({
        url: 'https://www.ti.com/lit/ds/symlink/tms320f28379d.pdf',
        domain: 'ti.com',
        filename: 'tms320f28379d.pdf',
        pageTitle: 'Texas Instruments - TMS320F28379D Dual-Core Microcontroller Datasheet',
      });

      expect(res).not.toBeNull();
      expect(res?.domain).toBe('Engineering');
      expect(res?.microIntent).toBe('Datasheet');
      expect(res?.shelfKey).toBe('eng_datasheets');
      expect(res?.shelfLabel).toBe('Datasheets');
      expect(res?.entities.organization).toBe('Texas_Instruments');
      expect(res?.suggestedSavePath).toBe('Engineering/Datasheets/Texas_Instruments');
      expect(res?.suggestedFilename).toContain('[Datasheet]_Texas_Instruments');
    });

    it('classifies Automotive Repair Manuals into Automotive/Repair_Manuals', () => {
      const res = classifyDownloadDynamic({
        url: 'https://techinfo.toyota.com/manuals/rav4_workshop_manual.pdf',
        domain: 'techinfo.toyota.com',
        filename: 'rav4_workshop_manual.pdf',
        pageTitle: 'Toyota Workshop Service Manual - 2026 RAV4 Wiring Diagram',
      });

      expect(res).not.toBeNull();
      expect(res?.domain).toBe('Automotive');
      expect(res?.microIntent).toBe('Repair_Manual');
      expect(res?.shelfKey).toBe('auto_manuals');
      expect(res?.shelfLabel).toBe('Auto & Repair Manuals');
      expect(res?.entities.organization).toBe('Toyota');
      expect(res?.suggestedSavePath).toBe('Automotive/Repair_Manuals/Toyota');
      expect(res?.suggestedFilename).toContain('[Manual]_Toyota');
    });

    it('integrates dynamic smart badges and routing for non-traditional domains', () => {
      const routingEngine = new RoutingEngine([]);
      const res = resolveDownloadRoute({
        url: 'https://portal.mayoclinic.org/patients/lab/results/blood_test_2026.pdf',
        filename: 'blood_test_2026.pdf',
        category: 'document',
        pageTitle: 'Mayo Clinic - Patient Blood Test Results 2026',
        settings: {
          ...DEFAULT_SETTINGS,
          enableRoutingRules: false,
          enableSmartRouting: true,
        },
        routingEngine,
      });

      expect(res.semantic?.domain).toBe('Healthcare');
      expect(res.smartBadge?.label).toBe('Medical Reports');
      expect(res.smartBadge?.folder).toBe('Healthcare/Lab_Reports/Mayo_Clinic/2026');
      expect(res.smartBadge?.shelfKey).toBe('healthcare_lab');
    });

    it('respects dynamic smartRoutingStructure and smartFilenameClean settings', () => {
      const routingEngine = new RoutingEngine([]);

      // 1. structure: 'domain'
      const resDomain = resolveDownloadRoute({
        url: 'https://portal.mayoclinic.org/patients/lab/results/blood_test_2026.pdf',
        filename: 'blood_test_2026.pdf',
        category: 'document',
        pageTitle: 'Mayo Clinic - Patient Blood Test Results 2026',
        settings: {
          ...DEFAULT_SETTINGS,
          enableRoutingRules: false,
          enableSmartRouting: true,
          smartRoutingStructure: 'domain',
        },
        routingEngine,
      });
      expect(resDomain.savePath).toContain('portal.mayoclinic.org/2026');

      // 2. structure: 'category'
      const resCategory = resolveDownloadRoute({
        url: 'https://portal.mayoclinic.org/patients/lab/results/blood_test_2026.pdf',
        filename: 'blood_test_2026.pdf',
        category: 'document',
        categoryFolder: 'Documents',
        pageTitle: 'Mayo Clinic - Patient Blood Test Results 2026',
        settings: {
          ...DEFAULT_SETTINGS,
          enableRoutingRules: false,
          enableSmartRouting: true,
          smartRoutingStructure: 'category',
        },
        routingEngine,
      });
      expect(resCategory.savePath).toContain('Documents/');

      // 3. smartFilenameClean: false preserves original filename
      const resRaw = resolveDownloadRoute({
        url: 'https://portal.mayoclinic.org/patients/lab/results/blood_test_2026.pdf',
        filename: 'blood_test_2026.pdf',
        category: 'document',
        pageTitle: 'Mayo Clinic - Patient Blood Test Results 2026',
        settings: {
          ...DEFAULT_SETTINGS,
          enableRoutingRules: false,
          enableSmartRouting: true,
          smartFilenameClean: false,
        },
        routingEngine,
      });
      expect(resRaw.filename).toBe('blood_test_2026.pdf');
    });
  });
});
