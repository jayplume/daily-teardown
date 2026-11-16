// Turns the files saved by scripts/spike.mjs into a playable object without spending credits again.
// Usage: node scripts/import-spike.ts <spike dir> "<name>" "<prompt>" "<motion prompt>" [daily YYYY-MM-DD]
import { promises as fs } from "node:fs";
import path from "node:path";
import { predictedSizeMm, shrinkGlb, unpackRig } from "../lib/server/assets.ts";

const [src, name, prompt, motionPrompt, daily] = process.argv.slice(2);
const id = `obj-${path.basename(src)}`;
const dir = path.join("data/files", id);
await fs.mkdir(dir, { recursive: true });
await fs.copyFile(path.join(src, "whole.glb"), path.join(dir, "whole.glb"));
await fs.copyFile(path.join(src, "parts.glb"), path.join(dir, "parts.glb"));
const sizeMm = await predictedSizeMm(path.join(dir, "whole.glb"));
await shrinkGlb(path.join(dir, "whole.glb"));
await shrinkGlb(path.join(dir, "parts.glb"));
let rig = null;
try {
  rig = await unpackRig(await fs.readFile(path.join(src, "motion.zip")), dir, `/api/file/${id}`);
} catch {}
const file = "data/objects.json";
const all = JSON.parse(await fs.readFile(file, "utf8").catch(() => "[]")).filter((o: { id: string }) => o.id !== id);
all.push({ id, name, source: "lux3d", partsUrl: `/api/file/${id}/parts.glb`, wholeUrl: `/api/file/${id}/whole.glb`, rig: rig ?? undefined, prompt, motionPrompt, daily, sizeMm, createdAt: Date.now(),
  stages: JSON.parse(await fs.readFile(path.join(src, "stages.json"), "utf8").catch(() => "[]")) });
await fs.writeFile(file, JSON.stringify(all, null, 2));
console.log(id, "sizeMm", sizeMm, "rig", JSON.stringify(rig)?.slice(0, 400));
for (const f of await fs.readdir(dir, { recursive: true })) console.log(" ", f, ((await fs.stat(path.join(dir, f))).size / 1e6).toFixed(2) + "MB");
