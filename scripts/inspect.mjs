import { readFileSync } from "node:fs";
for (const f of process.argv.slice(2)) {
  const b = readFileSync(f);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString());
  console.log("==", f, (b.length / 1e6).toFixed(1) + "MB");
  console.log(" scenes", j.scenes?.length, "nodes", j.nodes?.length, "meshes", j.meshes?.length, "materials", j.materials?.length, "images", j.images?.length, "anims", j.animations?.length, "skins", j.skins?.length);
  console.log(" root nodes", JSON.stringify(j.scenes?.[0]?.nodes));
  (j.nodes ?? []).slice(0, 30).forEach((n, i) => console.log("  node", i, JSON.stringify({ name: n.name, mesh: n.mesh, children: n.children, t: n.translation, r: n.rotation, s: n.scale, m: n.matrix ? "matrix" : undefined })));
  (j.meshes ?? []).slice(0, 30).forEach((m, i) => console.log("  mesh", i, m.name, "prims", m.primitives.length, "verts", m.primitives.map((p) => j.accessors[p.attributes.POSITION].count).join(","), "mat", m.primitives.map((p) => p.material).join(",")));
  (j.animations ?? []).forEach((a) => console.log("  anim", a.name, "channels", a.channels.map((c) => `${c.target.node}:${c.target.path}`).join(" "), "dur", Math.max(...a.samplers.map((s) => j.accessors[s.input].max?.[0] ?? 0))));
  console.log(" images", (j.images ?? []).map((im) => im.mimeType + ":" + (j.bufferViews[im.bufferView]?.byteLength / 1e6).toFixed(1) + "MB").join(" "));
  console.log(" extras", JSON.stringify(j.asset), JSON.stringify(j.extensionsUsed), JSON.stringify(j.scenes?.[0]?.extras ?? j.extras ?? null)?.slice(0, 300));
}
