import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_ROOTS = [
  "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\Presets",
  "C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\Presets",
  path.join(os.homedir(), "Documents", "Adobe", "After Effects"),
  path.join(os.homedir(), "AppData", "Roaming", "Adobe", "After Effects"),
];

function walk(dir, maxDepth, depth, out) {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, maxDepth, depth + 1, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".ffx")) {
      out.push(full);
    }
  }
}

// query: optional case-insensitive substring match on filename/path.
// roots: optional override of directories to search.
export function listPresets({ query, roots, maxDepth = 10, maxResults = 500 } = {}) {
  const searchRoots = roots && roots.length ? roots : DEFAULT_ROOTS;
  const found = [];
  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    walk(root, maxDepth, 0, found);
  }
  const q = (query || "").toLowerCase();
  const filtered = q ? found.filter((p) => p.toLowerCase().includes(q)) : found;
  const results = filtered.slice(0, maxResults).map((p) => ({ path: p, name: path.basename(p) }));
  return { presets: results, truncated: filtered.length > maxResults, searchedRoots: searchRoots.filter(fs.existsSync) };
}
