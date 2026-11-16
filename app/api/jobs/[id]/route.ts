import { NextResponse } from "next/server";
import { getJob } from "@/lib/server/pipeline";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "That build was not found. The server may have restarted." }, { status: 404 });
  return NextResponse.json(job);
}
