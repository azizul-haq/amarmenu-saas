import * as fs from 'fs';

interface Row {
  id: string;
  feature: string;
  status: string;
  testFile: string;
  testTitle: string;
  assertion: string;
  evidenceRaw: string;
}

function parseOwnerAudit(filePath: string): Row[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const results: Row[] = [];

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 8) continue;
    const id = parts[1];
    const feature = parts[2].replace(/\*\*/g, '').trim();
    const status = parts[7].replace(/\*\*/g, '').trim();
    const evidence = parts[8] || '';

    if (!id.startsWith('OWN-')) continue;
    if (status.includes('UNCONFIRMED') || status.includes('VERIFIED')) {
      const fileMatch = evidence.match(/`([^`]+\.test\.ts)`/);
      const testFile = fileMatch ? fileMatch[1] : 'N/A';

      const titleMatch = evidence.match(/>\s*\*+["']?([^"*]+?)["']?\*+/);
      let testTitle = titleMatch ? titleMatch[1].trim() : 'N/A';
      if (testTitle.endsWith('"') || testTitle.endsWith("'")) {
        testTitle = testTitle.slice(0, -1);
      }

      const assertMatch = evidence.match(/Assertion:\s*`([^`]+)`/);
      const assertion = assertMatch ? assertMatch[1] : 'N/A';

      results.push({
        id,
        feature,
        status,
        testFile,
        testTitle,
        assertion,
        evidenceRaw: evidence,
      });
    }
  }

  return results;
}

function parseSuperAdminAudit(filePath: string): Row[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const results: Row[] = [];

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 9) continue;
    const id = parts[1];
    const feature = parts[2].replace(/\*\*/g, '').trim();
    const status = parts[4].replace(/\*\*/g, '').trim();
    const evidence = parts[9] || '';

    if (!id.startsWith('SA-')) continue;
    if (status.includes('UNCONFIRMED') || status.includes('VERIFIED')) {
      const fileMatch = evidence.match(/`([^`]+\.test\.ts)`/);
      const testFile = fileMatch ? fileMatch[1] : 'N/A';

      const titleMatch = evidence.match(/>\s*\*+["']?([^"*]+?)["']?\*+/);
      let testTitle = titleMatch ? titleMatch[1].trim() : 'N/A';
      if (testTitle.endsWith('"') || testTitle.endsWith("'")) {
        testTitle = testTitle.slice(0, -1);
      }

      const assertMatch = evidence.match(/Assertion:\s*`([^`]+)`/);
      const assertion = assertMatch ? assertMatch[1] : 'N/A';

      results.push({
        id,
        feature,
        status,
        testFile,
        testTitle,
        assertion,
        evidenceRaw: evidence,
      });
    }
  }

  return results;
}

import * as path from 'path';

const resolvePath = (f: string) => fs.existsSync(f) ? f : path.join('docs', 'audits', f);

const ownerRows = parseOwnerAudit(resolvePath('OWNER_AUDIT.md'));
const saRows = parseSuperAdminAudit(resolvePath('SUPER_ADMIN_AUDIT.md'));

console.log(`OWNER UNCONFIRMED/VERIFIED rows: ${ownerRows.length}`);
console.log(`SUPER ADMIN UNCONFIRMED/VERIFIED rows: ${saRows.length}`);

// Generate a Markdown table
console.log('\n### Reconciled UNCONFIRMED / VERIFIED Matrix\n');
console.log('| Row ID | Feature Name | Status | Test File | Test Title | Quoted Assertion Line |');
console.log('| :--- | :--- | :--- | :--- | :--- | :--- |');

for (const r of [...saRows, ...ownerRows]) {
  console.log(`| \`${r.id}\` | ${r.feature} | **${r.status}** | \`${r.testFile}\` | "${r.testTitle}" | \`${r.assertion}\` |`);
}
