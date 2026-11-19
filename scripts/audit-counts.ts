import fs from 'fs';
import path from 'path';

interface AuditStats {
  file: string;
  totalTableLines: number;
  headerLines: number;
  categoryHeaderLines: number;
  featureRows: number;
  statusCounts: Record<string, number>;
  verifiedRows: { id: string; line: number; name: string; assertion: string; evidence: string }[];
  validationErrors: string[];
}

const GENERIC_ASSERTION_DENYLIST = [
  { name: 'toBeDefined()', regex: /\.toBeDefined\(\)/i },
  { name: 'bare error toBeNull()', regex: /\.toBeNull\(\)/i },
  { name: 'toHaveProperty()', regex: /\.toHaveProperty\(/i },
  { name: 'length >= 1', regex: /(?:\.length\)\.toBeGreaterThanOrEqual\(1\)|\.length\)\.toBeGreaterThan\(0\)|length\s*>=\s*1)/i },
  { name: 'res.success toBe(true)', regex: /expect\(res\.success\)\.toBe\(true\)/i },
  { name: 'toBeTruthy()', regex: /\.toBeTruthy\(\)/i },
];

function parseAuditFile(filePath: string): AuditStats {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  let totalTableLines = 0;
  let headerLines = 0;
  let categoryHeaderLines = 0;
  let featureRows = 0;
  const statusCounts: Record<string, number> = {};
  const verifiedRows: { id: string; line: number; name: string; assertion: string; evidence: string }[] = [];
  const validationErrors: string[] = [];

  const validStatuses = ['UNCONFIRMED', 'VERIFIED', 'UI-ONLY', 'BACKEND-ONLY', 'SIMULATED', 'PARTIAL', 'NOT BUILT', 'BLOCKED', 'DEFECT / PARTIAL'];

  let inSection1 = false;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('## 1. Feature Audit Matrix') || trimmed.startsWith('## 1. Complete Capability Matrix')) {
      inSection1 = true;
      return;
    }
    if (inSection1 && (trimmed.startsWith('## 2.') || trimmed.startsWith('--- \n## 2.'))) {
      inSection1 = false;
      return;
    }

    if (!inSection1) return;

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      totalTableLines++;

      if (trimmed.includes('---') || (trimmed.includes('| Feature |') && trimmed.includes('| Status |'))) {
        headerLines++;
        return;
      }

      const cells = trimmed.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);

      // Check if it's a category header row in OWNER_AUDIT (e.g., | | **1. Onboarding** | | ...)
      const isCategoryHeader =
        (cells[0] === '' && /^\*\*\d+\./.test(cells[1]) && cells.slice(2).every(c => c === '' || c === '-')) ||
        (/^\*\*\d+\./.test(cells[0]) && cells.slice(1).every(c => c === '' || c === '-'));

      if (isCategoryHeader) {
        categoryHeaderLines++;
        return;
      }

      featureRows++;

      const rowId = cells[0] || `ROW-${featureRows}`;
      const featureName = (cells[1] || '').replace(/\*\*/g, '').trim();

      // Find status in row
      let matchedStatus = 'OTHER';
      if (/re-run\s*(on\s*new\s*project)?:\s*pending/i.test(trimmed) || /re-run\s*pending/i.test(trimmed) || /\bUNCONFIRMED\b/i.test(trimmed)) {
        matchedStatus = 'UNCONFIRMED';
      } else {
        for (const st of validStatuses) {
          const regex = new RegExp(`(\\*\\*${st}\\*\\*|\\b${st}\\b)`);
          if (regex.test(trimmed)) {
            matchedStatus = st;
            break;
          }
        }
      }

      statusCounts[matchedStatus] = (statusCounts[matchedStatus] || 0) + 1;

      // Extract Evidence / Quoted assertion
      const evidenceCell = cells.find(c => c.includes('.test.ts') || c.includes('Assertion:'));
      let quotedAssertion = '';
      if (evidenceCell) {
        const assertMatch = evidenceCell.match(/Assertion:\s*`([^`]+)`/i);
        if (assertMatch) {
          quotedAssertion = assertMatch[1].trim();
        }
      }

      if (matchedStatus === 'UNCONFIRMED' || matchedStatus === 'VERIFIED') {
        verifiedRows.push({
          id: rowId,
          line: idx + 1,
          name: featureName,
          assertion: quotedAssertion,
          evidence: evidenceCell || '',
        });

        // 1. Check against generic assertion denylist
        for (const item of GENERIC_ASSERTION_DENYLIST) {
          if (item.regex.test(quotedAssertion)) {
            validationErrors.push(
              `Row ${rowId} (${featureName}) cites generic denylisted assertion [${item.name}]: "${quotedAssertion}" without specific value assertion.`
            );
          }
        }
      }
    }
  });

  // 2. Check duplicate quoted lines across different rows
  const seenAssertions = new Map<string, string>();
  for (const vr of verifiedRows) {
    if (vr.assertion && seenAssertions.has(vr.assertion)) {
      validationErrors.push(
        `Duplicate assertion line cited: "${vr.assertion}" is used by both ${seenAssertions.get(vr.assertion)} and ${vr.id} (${vr.name}).`
      );
    } else if (vr.assertion) {
      seenAssertions.set(vr.assertion, `${vr.id} (${vr.name})`);
    }
  }

  return {
    file: path.basename(filePath),
    totalTableLines,
    headerLines,
    categoryHeaderLines,
    featureRows,
    statusCounts,
    verifiedRows,
    validationErrors,
  };
}

export function runAuditCounts() {
  const ownerStats = parseAuditFile('OWNER_AUDIT.md');
  const adminStats = parseAuditFile('SUPER_ADMIN_AUDIT.md');

  console.log('===============================================================');
  console.log(' AUDIT STATUS COUNTS REPORT (SECTION 1 FEATURE MATRICES ONLY)');
  console.log('===============================================================\n');

  let hasErrors = false;

  [ownerStats, adminStats].forEach(stats => {
    console.log(`File: ${stats.file}`);
    console.log(`- Total Section 1 Table Lines:   ${stats.totalTableLines}`);
    console.log(`- Header & Separator Lines:      ${stats.headerLines}`);
    console.log(`- Category Section Header Rows:  ${stats.categoryHeaderLines}`);
    console.log(`- Total Individual Feature Rows: ${stats.featureRows}`);
    console.log('Status Breakdown:');
    for (const [status, cnt] of Object.entries(stats.statusCounts)) {
      console.log(`  * ${status.padEnd(16)}: ${cnt}`);
    }
    console.log(`- Exact VERIFIED Count:          ${stats.verifiedRows.length}`);

    if (stats.validationErrors.length > 0) {
      hasErrors = true;
      console.error(`\n[VALIDATION ERRORS in ${stats.file}]:`);
      stats.validationErrors.forEach(err => console.error(`  ! ${err}`));
    }
    console.log('---------------------------------------------------------------');
  });

  if (hasErrors) {
    throw new Error('Audit verification failed due to denylisted or duplicated assertion citations.');
  }

  return { ownerStats, adminStats };
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('audit-counts')) {
  runAuditCounts();
}
