import { promises as fs } from "node:fs";
import path from "node:path";
import { FILES_DIR, listGenerated } from "@/lib/server/store";

const TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  await listGenerated();
  const parts = (await ctx.params).path;
  const file = path.join(FILES_DIR, ...parts);
  // Refuse anything that resolves outside the files folder.
  if (!file.startsWith(FILES_DIR + path.sep)) return new Response("Not found", { status: 404 });
  try {
    // Files can be replaced by a better-compressed copy, so browsers keep
    // their copy but check it is still current (a tiny 304) before reusing it.
    const stat = await fs.stat(file);
    const etag = `"${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}"`;
    const headers = { ETag: etag, "Cache-Control": "public, no-cache" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    const data = await fs.readFile(file);
    return new Response(new Uint8Array(data), {
      headers: {
        ...headers,
        "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(data.byteLength),
        // Lets the loading bar work even when a proxy compresses the response.
        "X-File-Size": String(data.byteLength),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
