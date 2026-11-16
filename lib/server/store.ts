import { promises as fs } from "node:fs";
import path from "node:path";
import { GENERIC_DECOYS, PRACTICE } from "../catalog";
import type { Score, TeardownObject } from "../types";
import { todayISO } from "../types";

/**
 * File-backed storage. Lux3D result links expire after two hours, so every
 * generated file is copied here and served from /api/file/….
 */
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
const SEED_DIR = path.join(process.cwd(), "seed");
export const FILES_DIR = path.join(DATA_DIR, "files");
const OBJECTS = path.join(DATA_DIR, "objects.json");
const SCORES = path.join(DATA_DIR, "scores.json");

let writing: Promise<unknown> = Promise.resolve();

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Serialises writes so two requests cannot clobber each other. */
function writeJson(file: string, value: unknown): Promise<void> {
  const next = writing.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, file);
  });
  writing = next.catch(() => undefined);
  return next;
}

let seeded: Promise<void> | null = null;

const SEED_MARK = path.join(DATA_DIR, ".seed-version");

/**
 * A fresh server starts with an empty data folder. The objects that ship with
 * the project are copied in once so the daily puzzle works from the first request.
 * When the shipped files change (seed/VERSION), they replace the stored copies;
 * objects.json is left alone because it also lists what visitors have made.
 */
function ensureSeed(): Promise<void> {
  return (seeded ??= (async () => {
    try {
      const want = (await fs.readFile(path.join(SEED_DIR, "VERSION"), "utf8").catch(() => "1")).trim();
      const have = (await fs.readFile(SEED_MARK, "utf8").catch(() => "")).trim();
      const fresh = await fs.access(OBJECTS).then(
        () => false,
        () => true,
      );
      if (!fresh && have === want) return;
      await fs.mkdir(FILES_DIR, { recursive: true });
      await fs.cp(path.join(SEED_DIR, "files"), FILES_DIR, { recursive: true, force: true });
      if (fresh) await fs.copyFile(path.join(SEED_DIR, "objects.json"), OBJECTS);
      await fs.writeFile(SEED_MARK, want);
    } catch {
      // No seed folder: the game falls back to practice objects.
    }
  })());
}

export async function listGenerated(): Promise<TeardownObject[]> {
  await ensureSeed();
  return readJson<TeardownObject[]>(OBJECTS, []);
}

export async function listObjects(): Promise<TeardownObject[]> {
  const generated = await listGenerated();
  return [...generated.sort((a, b) => b.createdAt - a.createdAt), ...PRACTICE];
}

const listNames = (names: string[]) => {
  const all = names.map((n, i) => (i === 0 ? n : n.toLowerCase()));
  return all.length < 2 ? all.join("") : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
};

const BENCH_EPOCH = Date.UTC(2026, 10, 16);
const dayNumber = (date: string) => Math.max(1, Math.floor((Date.parse(date) - BENCH_EPOCH) / 86400000) + 1);

/**
 * Lux3D objects split into two to five parts each, which is too few for a
 * puzzle on their own. A bench puts up to three of them side by side and
 * mixes all their parts into one pile. Benches are derived from the date, so
 * they need no storage and everyone gets the same one.
 */
function benchFor(date: string, generated: TeardownObject[]): TeardownObject | null {
  const pool = generated.filter((o) => !o.members && o.partsUrl).sort((a, b) => a.createdAt - b.createdAt);
  if (pool.length < 2) return null;
  const n = dayNumber(date);
  const size = Math.min(3, pool.length);
  const picked = Array.from({ length: size }, (_, i) => pool[(n - 1 + i) % pool.length]);
  return {
    id: `bench-${date}`,
    name: listNames(picked.map((o) => o.name)),
    source: "lux3d",
    members: picked.map((o) => o.id),
    daily: date,
    createdAt: Date.parse(date),
  };
}

export async function getObject(id: string): Promise<TeardownObject | null> {
  const bench = /^bench-(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (bench) return benchFor(bench[1], await listGenerated());
  return (await listObjects()).find((o) => o.id === id) ?? null;
}

/** The objects actually on the mat: a bench's members, or the object itself. */
export async function membersOf(obj: TeardownObject): Promise<TeardownObject[]> {
  if (!obj.members?.length) return [obj];
  const all = await listObjects();
  return obj.members.map((id) => all.find((o) => o.id === id)).filter((o): o is TeardownObject => Boolean(o));
}

export async function saveObject(obj: TeardownObject): Promise<void> {
  const all = await listGenerated();
  const i = all.findIndex((o) => o.id === obj.id);
  if (i >= 0) all[i] = obj;
  else all.push(obj);
  await writeJson(OBJECTS, all);
}

/**
 * Today's puzzle: an object pinned to today's date if there is one, otherwise
 * a bench of Lux3D objects, otherwise a practice object.
 */
export async function getDaily(date = todayISO()): Promise<{ object: TeardownObject; number: number }> {
  const generated = await listGenerated();
  const number = dayNumber(date);
  const pinned = generated.find((o) => o.daily === date);
  if (pinned) return { object: pinned, number };
  const bench = benchFor(date, generated);
  if (bench) return { object: bench, number };
  const from = generated.length ? generated : PRACTICE;
  return { object: from[(number - 1) % from.length], number };
}

export function decoysFor(obj: TeardownObject, all: TeardownObject[]): string[] {
  if (obj.decoys?.length) return obj.decoys.slice(0, 3);
  const names = [...all.map((o) => o.name), ...GENERIC_DECOYS].filter(
    (n) => n.toLowerCase() !== obj.name.toLowerCase(),
  );
  // Deterministic per object so a reload does not reshuffle the choices.
  let seed = [...obj.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const picked: string[] = [];
  const pool = [...new Set(names)];
  while (picked.length < 3 && pool.length) {
    seed = (seed * 9301 + 49297) % 233280;
    picked.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return picked;
}

export async function listScores(objectId: string): Promise<Score[]> {
  const all = await readJson<Score[]>(SCORES, []);
  return all.filter((s) => s.objectId === objectId).sort((a, b) => a.ms - b.ms);
}

export async function getScore(id: string): Promise<Score | null> {
  const all = await readJson<Score[]>(SCORES, []);
  return all.find((s) => s.id === id) ?? null;
}

export async function addScore(score: Score): Promise<void> {
  const all = await readJson<Score[]>(SCORES, []);
  all.push(score);
  await writeJson(SCORES, all);
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
