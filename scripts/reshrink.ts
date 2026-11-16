// Re-runs the model compression over files that are already stored.
// Usage: node scripts/reshrink.ts seed/files
import { promises as fs } from "node:fs";
import path from "node:path";
import { shrinkGlb } from "../lib/server/assets.ts";

const root = path.resolve(process.argv[2] ?? "seed/files");
for (const entry of await fs.readdir(root, { recursive: true })) {
  if (!entry.endsWith(".glb")) continue;
  const file = path.join(root, entry);
  const before = (await fs.stat(file)).size;
  await shrinkGlb(file);
  const after = (await fs.stat(file)).size;
  console.log(`${entry}  ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
}
