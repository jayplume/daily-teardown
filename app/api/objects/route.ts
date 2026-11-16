import { NextResponse } from "next/server";
import { getDaily, listObjects } from "@/lib/server/store";
import { hasApiKey } from "@/lib/server/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  const [objects, daily] = await Promise.all([listObjects(), getDaily()]);
  return NextResponse.json({ objects, dailyId: daily.object.id, dailyNumber: daily.number, canMake: hasApiKey() });
}
