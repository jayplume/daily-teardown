import { NextResponse } from "next/server";
import { addScore, getObject, getScore, listScores, newId } from "@/lib/server/store";
import type { Difficulty, Score } from "@/lib/types";

export const dynamic = "force-dynamic";

const LEVELS: Difficulty[] = ["easy", "medium", "hard"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const score = await getScore(id);
    return score ? NextResponse.json(score) : NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const objectId = url.searchParams.get("object");
  if (!objectId) return NextResponse.json({ error: "Missing object" }, { status: 400 });
  const scores = await listScores(objectId);
  return NextResponse.json(scores.slice(0, 50));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<Score> | null;
  if (!body?.objectId || !(await getObject(body.objectId))) {
    return NextResponse.json({ error: "Unknown object" }, { status: 400 });
  }
  const ms = Number(body.ms);
  const timeline = Array.isArray(body.timeline) ? body.timeline.map(Number).filter(Number.isFinite).slice(0, 64) : [];
  if (!Number.isFinite(ms) || ms < 1500 || ms > 3_600_000 || !LEVELS.includes(body.difficulty as Difficulty)) {
    return NextResponse.json({ error: "That run could not be saved." }, { status: 400 });
  }
  const score: Score = {
    id: newId("run"),
    objectId: body.objectId,
    difficulty: body.difficulty as Difficulty,
    name: String(body.name ?? "").trim().slice(0, 18) || "Anonymous",
    ms: Math.round(ms),
    moves: Math.max(0, Math.round(Number(body.moves) || 0)),
    hints: Math.max(0, Math.round(Number(body.hints) || 0)),
    mystery: Boolean(body.mystery),
    timeline,
    createdAt: Date.now(),
  };
  await addScore(score);
  const board = (await listScores(score.objectId)).filter((s) => s.difficulty === score.difficulty);
  return NextResponse.json({ score, rank: board.findIndex((s) => s.id === score.id) + 1, of: board.length });
}
