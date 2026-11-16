export type Difficulty = "easy" | "medium" | "hard";

export type ObjectSource = "lux3d" | "practice";

/** One thing you can take apart. */
export interface TeardownObject {
  id: string;
  name: string;
  source: ObjectSource;
  /** Split-parts GLB for lux3d objects. Practice objects are built in the browser. */
  partsUrl?: string;
  /** Joints from Lux3D articulation, played when the object is rebuilt. */
  rig?: MotionRig;
  /** The unsplit model, kept for the "how it was made" panel and exports. */
  wholeUrl?: string;
  photoUrl?: string;
  prompt?: string;
  motionPrompt?: string;
  author?: string;
  /** A bench: ids of the objects whose parts are mixed into one pile. */
  members?: string[];
  /** ISO date (YYYY-MM-DD) if this is a daily object. */
  daily?: string;
  createdAt: number;
  /** How long each Lux3D step took, shown to players and judges. */
  stages?: { name: string; label: string; ms: number }[];
  /** Wrong answers for mystery mode. */
  decoys?: string[];
  /** Real-world size in millimetres if Lux3D predicted one. */
  sizeMm?: number;
}

/** A URDF-style rig: rigid links connected by joints. */
export interface MotionRig {
  links: { name: string; meshUrl?: string; xyz: [number, number, number]; rpy: [number, number, number] }[];
  joints: {
    name: string;
    type: "revolute" | "continuous" | "prismatic" | "fixed";
    parent: string;
    child: string;
    xyz: [number, number, number];
    rpy: [number, number, number];
    axis: [number, number, number];
    lower: number;
    upper: number;
  }[];
}

export interface Score {
  id: string;
  objectId: string;
  difficulty: Difficulty;
  name: string;
  /** Final time in ms, penalties and bonuses included. */
  ms: number;
  moves: number;
  hints: number;
  mystery: boolean;
  /** Elapsed ms at which each part was placed, for ghost races. */
  timeline: number[];
  createdAt: number;
}

export type JobStatus =
  | "queued"
  | "generating"
  | "painting"
  | "splitting"
  | "animating"
  | "saving"
  | "done"
  | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  /** Jobs ahead of this one. Lux3D runs one generation at a time per account. */
  ahead: number;
  objectId?: string;
  error?: string;
  startedAt?: number;
  createdAt: number;
}

export function formatTime(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}

export function todayISO(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
