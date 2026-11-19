import fs from "fs";

const oldLines = fs.readFileSync("drift_old_project.txt", "utf8").trim().split("\n");
const newLines = fs.readFileSync("drift_new_project.txt", "utf8").trim().split("\n");

const oldSet = new Set(oldLines);
const newSet = new Set(newLines);

const inOldOnly = oldLines.filter((l) => !newSet.has(l));
const inNewOnly = newLines.filter((l) => !oldSet.has(l));

function groupByType(lines: string[]) {
  const groups: Record<string, string[]> = {};
  for (const l of lines) {
    const type = l.split("|")[0];
    if (!groups[type]) groups[type] = [];
    groups[type].push(l);
  }
  return groups;
}

const oldGrouped = groupByType(inOldOnly);
const newGrouped = groupByType(inNewOnly);

console.log("=== Old Project Only Breakdown ===");
for (const [k, v] of Object.entries(oldGrouped)) {
  console.log(`${k}: ${v.length} entries`);
}

console.log("\n=== New Project Only Breakdown ===");
for (const [k, v] of Object.entries(newGrouped)) {
  console.log(`${k}: ${v.length} entries`);
}

// Print non-colgrant differences
console.log("\n--- Old Only Policies ---");
console.log((oldGrouped["policy"] || []).join("\n"));

console.log("\n--- New Only Policies ---");
console.log((newGrouped["policy"] || []).join("\n"));

console.log("\n--- Old Only Functions ---");
console.log((oldGrouped["func"] || []).join("\n"));

console.log("\n--- New Only Functions ---");
console.log((newGrouped["func"] || []).join("\n"));

console.log("\n--- Old Only Grants ---");
console.log((oldGrouped["grant"] || []).join("\n"));

console.log("\n--- New Only Grants ---");
console.log((newGrouped["grant"] || []).join("\n"));

console.log("\n--- Old Only Columns ---");
console.log((oldGrouped["col"] || []).join("\n"));

console.log("\n--- New Only Columns ---");
console.log((oldGrouped["col"] || []).join("\n"));

console.log("\n--- Old Only Triggers ---");
console.log((oldGrouped["trigger"] || []).join("\n"));

console.log("\n--- New Only Triggers ---");
console.log((newGrouped["trigger"] || []).join("\n"));
