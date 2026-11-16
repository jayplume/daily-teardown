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

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  await listGenerated();
  const parts = (await ctx.params).path;
  const file = path.join(FILES_DIR, ...parts);
  // Refuse anything that resolves outside the files folder.
  if (!file.startsWith(FILES_DIR + path.sep)) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(file);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
