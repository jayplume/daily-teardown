// Runs one object through the full Lux3D chain and saves every result for inspection.
import { createLux3dClient } from "@manycore/aholo-sdk-lux3d";
import { writeFile } from "node:fs/promises";

const lux = createLux3dClient({ region: process.env.AHOLO_REGION === "cn" ? "cn" : "com" });
const wait = { intervalMs: 3000, timeoutMs: 10 * 60 * 1000 };
const out = process.argv[4] ?? "data/spike";
await (await import("node:fs/promises")).mkdir(out, { recursive: true });
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const taskId = await fn();
    const res = await lux.tasks.waitFor(taskId, wait);
    console.log(name, "ok", ((Date.now() - t0) / 1000).toFixed(0) + "s", JSON.stringify(res.outputs));
    return res.outputs.map((o) => o.content).filter((c) => c && c.startsWith("http"));
  } catch (e) {
    console.log(name, "FAILED", ((Date.now() - t0) / 1000).toFixed(0) + "s", e?.name, e?.message, JSON.stringify(e?.code ?? e?.body ?? ""));
    return [];
  }
};
const save = async (url, file) => {
  const r = await fetch(url);
  await writeFile(`${out}/${file}`, Buffer.from(await r.arrayBuffer()));
};

const prompt = process.argv[2] ?? "A red metal desk stapler";
const motion = process.argv[3] ?? "The top arm of the stapler swings open and closed";
const [whole] = await step("generate", () => lux.textTo3d.create({ prompt, style: "photorealistic", version: "G1-Turbo", outputFormat: ["glb"], aiPredictSize: true, faceCount: 60000 }));
if (!whole) process.exit(1);
await save(whole, "whole.glb");
const [parts] = await step("split", () => lux.partSplit.create({ glbUrl: whole }));
if (parts) await save(parts, "parts.glb");
const [anim] = await step("articulate", () => lux.articulationAnimation.create({ glbUrl: whole, prompt: motion }));
if (anim) await save(anim, "motion.zip");
