import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { enqueue, hasApiKey } from "@/lib/server/pipeline";
import { listGenerated, newId } from "@/lib/server/store";
import { todayISO } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAILY_LIMIT = Number(process.env.MAX_BUILDS_PER_DAY) || 12;
const PER_VISITOR = Number(process.env.MAX_BUILDS_PER_VISITOR) || 2;
const builds = new Map<string, number>();

const MAX_BYTES = 12 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

async function stash(file: FormDataEntryValue | null): Promise<string | undefined | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return undefined;
  const ext = EXT[file.type];
  if (!ext) return { error: "Photos must be JPG, PNG or WebP." };
  if (file.size > MAX_BYTES) return { error: "That photo is over 12 MB. Use a smaller one." };
  const dest = path.join(os.tmpdir(), `${newId("upload")}${ext}`);
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
  return dest;
}

export async function POST(req: Request) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "Making objects is switched off because this server has no Lux3D key yet." },
      { status: 503 },
    );
  }
  // The public demo shares one Lux3D account, so builds are rationed.
  const day = todayISO();
  const today = (await listGenerated()).filter((o) => todayISO(new Date(o.createdAt)) === day).length;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const mine = builds.get(`${day}:${ip}`) ?? 0;
  if (today >= DAILY_LIMIT) {
    return NextResponse.json({ error: `Today's ${DAILY_LIMIT} builds have been used. New ones open at midnight UTC.` }, { status: 429 });
  }
  if (mine >= PER_VISITOR) {
    return NextResponse.json({ error: `You have made ${PER_VISITOR} objects today, which is the limit per person.` }, { status: 429 });
  }

  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  const prompt = String(form.get("prompt") ?? "").trim().slice(0, 300);
  const motionPrompt = String(form.get("motion") ?? "").trim().slice(0, 200);
  const author = String(form.get("author") ?? "").trim().slice(0, 18);
  const daily = String(form.get("daily") ?? "");

  const photo = await stash(form.get("photo"));
  if (photo && typeof photo === "object") return NextResponse.json(photo, { status: 400 });
  const skin = await stash(form.get("skin"));
  if (skin && typeof skin === "object") return NextResponse.json(skin, { status: 400 });

  if (!name) return NextResponse.json({ error: "Give the object a name so players can guess it." }, { status: 400 });
  if (!photo && !prompt) return NextResponse.json({ error: "Add a photo or describe the object." }, { status: 400 });

  // Pinning a daily object needs the admin token so players cannot overwrite tomorrow's puzzle.
  const isAdmin = Boolean(process.env.ADMIN_TOKEN) && form.get("admin") === process.env.ADMIN_TOKEN;
  builds.set(`${day}:${ip}`, mine + 1);
  const job = enqueue({
    name,
    prompt: prompt || undefined,
    motionPrompt: motionPrompt || undefined,
    author: author || undefined,
    photoPath: photo,
    skinPath: skin,
    daily: isAdmin && /^\d{4}-\d{2}-\d{2}$/.test(daily) ? daily : undefined,
  });
  return NextResponse.json(job);
}
