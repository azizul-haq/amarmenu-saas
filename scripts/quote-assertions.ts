import fs from 'fs';
import path from 'path';

const testDir = 'src/tests';
const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts'));

export function findAssertionForTest(testNameSnippet: string): { file: string; line: number; assertion: string } | null {
  const cleanSnippet = testNameSnippet.replace(/["'*]/g, '').trim().toLowerCase();

  for (const f of testFiles) {
    const content = fs.readFileSync(path.join(testDir, f), 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('it(') && lines[i].toLowerCase().includes(cleanSnippet.slice(0, 30))) {
        // Collect expect lines
        for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
          if (lines[j].includes('it(')) break;
          const trimmed = lines[j].trim();
          if (trimmed.startsWith('expect(')) {
            return {
              file: f,
              line: j + 1,
              assertion: trimmed.replace(/`/g, "'").slice(0, 100),
            };
          }
        }
      }
    }
  }
  return null;
}

// Update audit files
function processAuditFile(filePath: string) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const updatedLines: string[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.trim().startsWith('|') && line.includes('VERIFIED')) {
      const parts = line.split('|');
      // parts[0] is empty, parts[1] is Feature, parts[3] is status in SUPER_ADMIN or parts[6] in OWNER
      // Let's find Evidence column
      const evidenceIdx = parts.findIndex(p => p.includes('.test.ts'));
      if (evidenceIdx !== -1) {
        const evidenceText = parts[evidenceIdx];
        const match = evidenceText.match(/`([^`]+\.test\.ts)`\s*(?:>|->)?\s*[*"']?([^"'\*|]+)/);
        if (match) {
          const testFile = match[1];
          const testSnippet = match[2];
          const found = findAssertionForTest(testSnippet);
          if (found) {
            // Append exact expect line
            const quote = `\`${found.assertion}\` (${found.file}#L${found.line})`;
            parts[evidenceIdx] = ` ${testFile} > *"${testSnippet.trim()}"* <br/>Assertion: ${quote} `;
          }
        }
      }
      
      // Update status to mark pending re-run on new project
      // Replace VERIFIED with **VERIFIED (pending new project run)**
      const statusIdx = parts.findIndex(p => p.trim().includes('VERIFIED'));
      if (statusIdx !== -1) {
        parts[statusIdx] = ` **VERIFIED (re-run on new project: pending)** `;
      }

      updatedLines.push(parts.join('|'));
    } else {
      updatedLines.push(line);
    }
  }

  fs.writeFileSync(filePath, updatedLines.join('\n'), 'utf-8');
  console.log(`Updated ${filePath}`);
}

import * as path from 'path';

const resolvePath = (f: string) => fs.existsSync(f) ? f : path.join('docs', 'audits', f);

processAuditFile(resolvePath('OWNER_AUDIT.md'));
processAuditFile(resolvePath('SUPER_ADMIN_AUDIT.md'));
