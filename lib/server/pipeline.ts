import { promises as fs } from "node:fs";
import path from "node:path";
import type { Job, JobStatus, TeardownObject } from "../types";
import { predictedSizeMm, shrinkGlb, unpackRig } from "./assets";
import { FILES_DIR, newId, saveObject } from "./store";

export interface MakeInput {
  name: string;
  author?: string;
  prompt?: string;
  motionPrompt?: string;
  /** Photo of the object, already written to disk. */
  photoPath?: string;
  /** Optional photo whose material is painted onto the model. */
  skinPath?: string;
  daily?: string;
}

interface QueueState {
  jobs: Map<string, Job>;
  order: string[];
  chain: Promise<void>;
}

// Kept on globalThis so the queue survives dev-server module reloads.
const g = globalThis as unknown as { __teardownQueue?: QueueState };
const state: QueueState = (g.__teardownQueue ??= { jobs: new Map(), order: [], chain: Promise.resolve() });

export function hasApiKey(): boolean {
  return Boolean(process.env.AHOLO_API_KEY);
}

function region(): "com" | "cn" {
  return process.env.AHOLO_REGION === "cn" ? "cn" : "com";
}

export function getJob(id: string): Job | null {
  const job = state.jobs.get(id);
  if (!job) return null;
  const waiting = state.order.filter((j) => {
    const s = state.jobs.get(j)?.status;
    return s !== "done" && s !== "failed";
  });
  return { ...job, ahead: Math.max(0, waiting.indexOf(id)) };
}

/**
 * Lux3D allows one generation at a time per account, so every request joins a
 * single line and the player is shown their place in it.
 */
export function enqueue(input: MakeInput): Job {
  const job: Job = { id: newId("job"), status: "queued", ahead: 0, createdAt: Date.now() };
  state.jobs.set(job.id, job);
  state.order.push(job.id);
  state.chain = state.chain.then(() => run(job, input)).catch(() => undefined);
  return getJob(job.id)!;
}

function firstUrl(outputs: { content?: string | null }[], ext: string): string {
  const urls = outputs.map((o) => o.content ?? "").filter((c) => c.startsWith("http"));
  const match = urls.find((u) => u.split("?")[0].toLowerCase().endsWith(ext));
  const url = match ?? urls[0];
  if (!url) throw new Error(`Lux3D finished but returned no ${ext} file.`);
  return url;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download a Lux3D result (${res.status}).`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function run(job: Job, input: MakeInput): Promise<void> {
  const objectId = newId("obj");
  const dir = path.join(FILES_DIR, objectId);
  const stages: NonNullable<TeardownObject["stages"]> = [];
  const set = (status: JobStatus) => {
    job.status = status;
  };
  const timed = async <T>(name: string, label: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const out = await fn();
    stages.push({ name, label, ms: Date.now() - t0 });
    return out;
  };

  try {
    job.startedAt = Date.now();
    const { createLux3dClient } = await import("@manycore/aholo-sdk-lux3d");
    const lux = createLux3dClient({ region: region() });
    const wait = { intervalMs: 3000, timeoutMs: 8 * 60 * 1000 };

    set("generating");
    let wholeUrl = await timed("generate", input.photoPath ? "Photo to 3D model" : "Text to 3D model", async () => {
      const common = { version: "G1-Turbo" as const, outputFormat: ["glb" as const], aiPredictSize: true, faceCount: 60000 };
      const taskId = input.photoPath
        ? await lux.imgTo3d.createFromFile(input.photoPath, common)
        : await lux.textTo3d.create({ prompt: input.prompt ?? input.name, style: "photorealistic", ...common });
      return firstUrl((await lux.tasks.waitFor(taskId, wait)).outputs, ".glb");
    });

    if (input.skinPath) {
      set("painting");
      wholeUrl = await timed("paint", "Material transfer", async () => {
        const { createAssetClient } = await import("@manycore/aholo-sdk-asset");
        const skin = await createAssetClient({ region: region() }).uploadFile(input.skinPath!);
        const taskId = await lux.materialTransfer.create({
          img: skin.url,
          meshUrl: wholeUrl,
          version: "v3.0-standard",
          outputFormat: ["glb"],
        });
        return firstUrl((await lux.tasks.waitFor(taskId, wait)).outputs, ".glb");
      });
    }

    // Splitting and articulation both start from the same model, so they run
    // together. If the account only allows one task at a time, articulation
    // is retried once the split has finished.
    set("splitting");
    const articulate = () =>
      timed("animate", "Articulation", async () => {
        const taskId = await lux.articulationAnimation.create({
          glbUrl: wholeUrl,
          prompt: input.motionPrompt?.trim() || "The main moving part opens and closes as it does in real use",
        });
        return firstUrl((await lux.tasks.waitFor(taskId, wait)).outputs, ".zip");
      });
    const early = articulate().catch((err: unknown) => ({ failed: err }));
    const partsUrl = await timed("split", "Split into parts", async () => {
      const taskId = await lux.partSplit.create({ glbUrl: wholeUrl });
      return firstUrl((await lux.tasks.waitFor(taskId, wait)).outputs, ".glb");
    });

    // The motion is the reward for rebuilding. If it fails the puzzle still works.
    set("animating");
    let rigZipUrl: string | undefined;
    const first = await early;
    if (typeof first === "string") rigZipUrl = first;
    else if (/CONCURRENCY|limit/i.test(String((first.failed as Error)?.message ?? first.failed))) {
      rigZipUrl = await articulate().catch((err) => {
        console.warn("[teardown] articulation skipped:", err);
        return undefined;
      });
    } else console.warn("[teardown] articulation skipped:", first.failed);

    set("saving");
    const base = `/api/file/${objectId}`;
    await download(wholeUrl, path.join(dir, "whole.glb"));
    const sizeMm = await predictedSizeMm(path.join(dir, "whole.glb"));
    await download(partsUrl, path.join(dir, "parts.glb"));
    await Promise.all([shrinkGlb(path.join(dir, "whole.glb")), shrinkGlb(path.join(dir, "parts.glb"))]);
    let rig: TeardownObject["rig"];
    if (rigZipUrl) {
      const res = await fetch(rigZipUrl);
      if (res.ok) rig = (await unpackRig(Buffer.from(await res.arrayBuffer()), dir, base)) ?? undefined;
    }
    let photoUrl: string | undefined;
    if (input.photoPath) {
      const ext = path.extname(input.photoPath) || ".jpg";
      await fs.copyFile(input.photoPath, path.join(dir, `photo${ext}`));
      photoUrl = `${base}/photo${ext}`;
    }

    await saveObject({
      id: objectId,
      name: input.name,
      source: "lux3d",
      partsUrl: `/api/file/${objectId}/parts.glb`,
      wholeUrl: `/api/file/${objectId}/whole.glb`,
      rig,
      sizeMm,
      photoUrl,
      prompt: input.prompt,
      motionPrompt: input.motionPrompt,
      author: input.author,
      daily: input.daily,
      createdAt: Date.now(),
      stages,
    });
    job.objectId = objectId;
    set("done");
  } catch (err) {
    job.error = explain(err);
    set("failed");
  } finally {
    for (const p of [input.photoPath, input.skinPath]) {
      if (p) await fs.rm(p, { force: true }).catch(() => undefined);
    }
  }
}

function explain(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/auth|api key|401|403/i.test(msg)) return "Lux3D rejected the API key. Check AHOLO_API_KEY in .env.local.";
  if (/CONCURRENCY/i.test(msg)) return "Lux3D is busy with another generation on this account. Try again in a minute.";
  if (/credit|quota|balance/i.test(msg)) return "This Lux3D account is out of credits.";
  if (/timeout/i.test(msg)) return "Lux3D took too long. Try again, or use a simpler photo.";
  return msg;
}
