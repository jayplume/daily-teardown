import { promises as fs } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import type { MotionRig } from "../types";

/**
 * Lux3D returns 15–25 MB GLBs, mostly 4K PNG textures. Shrinking the textures
 * to 1K WebP makes objects load in a second or two on a phone.
 */
export async function shrinkGlb(file: string): Promise<void> {
  try {
    const { NodeIO } = await import("@gltf-transform/core");
    const { EXTTextureWebP } = await import("@gltf-transform/extensions");
    const { textureCompress, dedup, prune } = await import("@gltf-transform/functions");
    const sharp = (await import("sharp")).default;
    const io = new NodeIO().registerExtensions([EXTTextureWebP]);
    const doc = await io.read(file);
    await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }));
    await io.write(file, doc);
  } catch (err) {
    // An unoptimised file still works; it is only slower to load.
    console.warn("[teardown] could not shrink", path.basename(file), err);
  }
}

const attr = (tag: string, name: string): string | undefined => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
const triple = (s: string | undefined): [number, number, number] => {
  const v = (s ?? "0 0 0").trim().split(/\s+/).map(Number);
  return [v[0] || 0, v[1] || 0, v[2] || 0];
};

/** Reads the links and joints out of the URDF that Lux3D articulation returns. */
export function parseUrdf(xml: string, meshUrl: (filename: string) => string): MotionRig {
  const links: MotionRig["links"] = [];
  for (const m of xml.matchAll(/<link\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/link>/g)) {
    const mesh = /<mesh\s+[^>]*filename="([^"]+)"/.exec(m[2])?.[1];
    const origin = /<visual>[\s\S]*?(<origin[^>]*>)/.exec(m[2])?.[1];
    links.push({
      name: m[1],
      meshUrl: mesh ? meshUrl(mesh) : undefined,
      xyz: triple(origin && attr(origin, "xyz")),
      rpy: triple(origin && attr(origin, "rpy")),
    });
  }
  const joints: MotionRig["joints"] = [];
  for (const m of xml.matchAll(/<joint\s+([^>]*)>([\s\S]*?)<\/joint>/g)) {
    const body = m[2];
    const tag = (name: string) => new RegExp(`<${name}\\s+[^>]*>`).exec(body)?.[0] ?? "";
    const type = attr(m[1], "type") ?? "fixed";
    const limit = tag("limit");
    const lower = Number(attr(limit, "lower"));
    const upper = Number(attr(limit, "upper"));
    joints.push({
      name: attr(m[1], "name") ?? "joint",
      type: type === "revolute" || type === "continuous" || type === "prismatic" ? type : "fixed",
      parent: attr(tag("parent"), "link") ?? "",
      child: attr(tag("child"), "link") ?? "",
      xyz: triple(attr(tag("origin"), "xyz")),
      rpy: triple(attr(tag("origin"), "rpy")),
      axis: triple(attr(tag("axis"), "xyz") ?? "1 0 0"),
      lower: Number.isFinite(lower) ? lower : 0,
      upper: Number.isFinite(upper) ? upper : type === "continuous" ? Math.PI * 2 : 0,
    });
  }
  return { links, joints };
}

/** Unpacks the articulation ZIP into the object's folder and returns its rig. */
export async function unpackRig(zip: Buffer, dir: string, urlBase: string): Promise<MotionRig | null> {
  const files = unzipSync(new Uint8Array(zip));
  const urdfPath = Object.keys(files).find((f) => f.toLowerCase().endsWith(".urdf"));
  if (!urdfPath) return null;
  const root = path.posix.dirname(urdfPath);
  const out = path.join(dir, "rig");
  const saved = new Map<string, string>();
  let n = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith(".glb")) continue;
    const safe = `link-${n++}.glb`;
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, safe), data);
    await shrinkGlb(path.join(out, safe));
    saved.set(path.posix.relative(root, name), safe);
  }
  const xml = Buffer.from(files[urdfPath]).toString("utf8");
  const rig = parseUrdf(xml, (filename) => {
    const safe = saved.get(path.posix.normalize(filename));
    return safe ? `${urlBase}/rig/${safe}` : "";
  });
  rig.links = rig.links.map((l) => ({ ...l, meshUrl: l.meshUrl || undefined }));
  return rig.joints.some((j) => j.type !== "fixed") ? rig : null;
}

/** Longest side in millimetres, from the size Lux3D predicted for the model. */
export async function predictedSizeMm(glb: string): Promise<number | undefined> {
  try {
    const b = await fs.readFile(glb);
    const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
    const meta = json.scenes?.[0]?.extras?.lux3d_metadata ?? json.extras?.lux3d_metadata;
    const { min, max } = meta?.bbox ?? {};
    if (!min || !max) return undefined;
    const longest = Math.max(...[0, 1, 2].map((i) => max[i] - min[i]));
    const perUnit = meta.predictUnit === "mm" ? 1 : meta.predictUnit === "cm" ? 10 : 1000;
    const mm = Math.round(longest * perUnit);
    return mm > 5 && mm < 5000 ? mm : undefined;
  } catch {
    return undefined;
  }
}
