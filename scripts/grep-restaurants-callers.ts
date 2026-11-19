import fs from 'fs';
import path from 'path';

function search(d: string) {
  for (const f of fs.readdirSync(d)) {
    if (f === 'node_modules' || f === '.git' || f === 'scratch') continue;
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) search(p);
    else if (/\.(ts|tsx)$/.test(f)) {
      const c = fs.readFileSync(p, 'utf-8');
      if (c.includes(".from('restaurants')") || c.includes('.from("restaurants")')) {
        const lines = c.split('\n');
        lines.forEach((l, i) => {
          if (l.includes(".from('restaurants')") || l.includes('.from("restaurants")')) {
            console.log(`${p}:L${i+1}: ${l.trim()}`);
          }
        });
      }
    }
  }
}

console.log('=== .from("restaurants") in src ===');
search('src');
console.log('\n=== .from("restaurants") in supabase/functions ===');
if (fs.existsSync('supabase/functions')) search('supabase/functions');
