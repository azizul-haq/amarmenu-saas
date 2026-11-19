import * as fs from 'fs';

const flaggedOwnerIds = new Set([
  'OWN-001', 'OWN-002', 'OWN-007', 'OWN-014', 'OWN-015',
  'OWN-023', 'OWN-036', 'OWN-037', 'OWN-038', 'OWN-039',
  'OWN-040', 'OWN-043', 'OWN-044', 'OWN-056', 'OWN-059',
  'OWN-060', 'OWN-066'
]);

const flaggedSaIds = new Set([
  'SA-011', 'SA-015', 'SA-018', 'SA-044', 'SA-047'
]);

function downgradeOwnerAudit(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const newLines = lines.map(line => {
    if (!line.startsWith('|')) return line;
    const parts = line.split('|');
    if (parts.length < 8) return line;
    const id = parts[1].trim();
    if (flaggedOwnerIds.has(id)) {
      parts[7] = ' **PARTIAL** ';
      return parts.join('|');
    }
    return line;
  });
  fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
}

function downgradeSaAudit(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const newLines = lines.map(line => {
    if (!line.startsWith('|')) return line;
    const parts = line.split('|');
    if (parts.length < 9) return line;
    const id = parts[1].trim();
    if (flaggedSaIds.has(id)) {
      parts[4] = ' **PARTIAL** ';
      return parts.join('|');
    }
    return line;
  });
  fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
}

import * as path from 'path';

const resolvePath = (f: string) => fs.existsSync(f) ? f : path.join('docs', 'audits', f);

downgradeOwnerAudit(resolvePath('OWNER_AUDIT.md'));
downgradeSaAudit(resolvePath('SUPER_ADMIN_AUDIT.md'));
console.log('Downgrade complete.');
