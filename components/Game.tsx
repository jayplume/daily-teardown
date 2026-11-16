"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Finish, TeardownEngine } from "@/lib/game/engine";
import { sfx } from "@/lib/game/sfx";
import { formatTime, todayISO, type Difficulty, type Score, type TeardownObject } from "@/lib/types";
import { HowItWasMade } from "./HowItWasMade";

interface Props {
  object: TeardownObject;
  /** What is on the mat: the object itself, or every member of a bench. */
  members: TeardownObject[];
  /** Set when this is today's daily object. */
  daily?: { number: number; date: string };
  /** A saved run to race against. */
  rival?: Score | null;
  /** Name choices for mystery mode, wrong answers only. */
  decoys: string[];
}

type Phase = "loading" | "ready" | "playing" | "done" | "error";

const HINT_COST = 10_000;
const GUESS_BONUS = 15_000;

const LEVELS: { id: Difficulty; label: string; loose: number; note: string }[] = [
  { id: "easy", label: "Easy", loose: 5, note: "the biggest ones" },
  { id: "medium", label: "Medium", loose: 9, note: "" },
  { id: "hard", label: "Hard", loose: 18, note: "turned around, no reference" },
];

function readDays(): string[] {
  try {
    return JSON.parse(localStorage.getItem("dt.days") ?? "[]");
  } catch {
    return [];
  }
}

function streakFrom(days: string[]): number {
  const set = new Set(days);
  const d = new Date();
  if (!set.has(todayISO(d))) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  while (set.has(todayISO(d))) {
    n++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

export function Game({ object, members, daily, rival, decoys }: Props) {
  const isBench = members.length > 1;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TeardownEngine | null>(null);
  const startRef = useRef(0);
  const timelineRef = useRef<number[]>([]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>(rival?.difficulty ?? "easy");
  const [mystery, setMystery] = useState(false);
  const [total, setTotal] = useState(0);
  const [partCount, setPartCount] = useState(0);
  const [placed, setPlaced] = useState(0);
  const [moves, setMoves] = useState(0);
  const [hints, setHints] = useState(0);
  const [penalty, setPenalty] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [reference, setReference] = useState(false);
  const [finish, setFinish] = useState<Finish>("original");
  const [muted, setMuted] = useState(false);
  const [guess, setGuess] = useState<"pending" | "asking" | "right" | "wrong">("pending");
  const [flash, setFlash] = useState("");
  const [streak, setStreak] = useState(0);
  const [nickname, setNickname] = useState("");
  const [saved, setSaved] = useState<{ score: Score; rank: number; of: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [board, setBoard] = useState<Score[]>([]);
  const [copied, setCopied] = useState(false);
  const [showMade, setShowMade] = useState(false);

  const finalMs = elapsed + penalty;
  const hidden = mystery && phase !== "done";
  const title = hidden ? "Mystery object" : object.name;

  const choices = useMemo(() => {
    const all = [object.name, ...decoys.slice(0, 3)];
    // Stable order per object so the answer is not always first.
    return all.sort((a, b) => ((a.length * 7 + a.charCodeAt(0)) % 11) - ((b.length * 7 + b.charCodeAt(0)) % 11));
  }, [object.name, decoys]);

  useEffect(() => {
    setStreak(streakFrom(readDays()));
    setNickname(localStorage.getItem("dt.name") ?? "");
    const m = localStorage.getItem("dt.muted") === "1";
    setMuted(m);
    sfx.setMuted(m);
  }, []);

  // Engine lifetime is tied to the canvas.
  useEffect(() => {
    let live = true;
    let engine: TeardownEngine | null = null;
    void import("@/lib/game/engine").then(({ TeardownEngine }) => {
      if (!live || !canvasRef.current) return;
      engine = new TeardownEngine(canvasRef.current, {
        onPlaced: (n) => {
          setPlaced(n);
          setMoves((m) => m + 1);
          timelineRef.current.push(performance.now() - startRef.current);
        },
        onMiss: () => setMoves((m) => m + 1),
        onComplete: () => {
          setElapsed(performance.now() - startRef.current);
          setPhase("done");
        },
      });
      engineRef.current = engine;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __teardown?: TeardownEngine }).__teardown = engine;
      setEngineReady(true);
    });
    return () => {
      live = false;
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  const [engineReady, setEngineReady] = useState(false);

  // (Re)load whenever the object or difficulty changes before play starts.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engineReady || !engine) return;
    let live = true;
    setPhase("loading");
    setLoaded(0);
    engine
      .load(members, difficulty, (f) => live && setLoaded(f))
      .then((info) => {
        if (!live) return;
        setTotal(info.total);
        setPartCount(info.partCount);
        setPlaced(0);
        setMoves(0);
        setHints(0);
        setPenalty(0);
        setElapsed(0);
        setGuess("pending");
        setSaved(null);
        setReference(false);
        timelineRef.current = [];
        setPhase("ready");
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(e.message || "This object could not be loaded.");
        setPhase("error");
      });
    return () => {
      live = false;
    };
  }, [engineReady, members, difficulty]);

  // The object makes room for whichever panel is showing.
  useEffect(() => {
    engineRef.current?.setFraming(phase === "ready" || phase === "error" ? 1 : phase === "done" ? -1 : 0);
  }, [phase, engineReady]);

  // Running clock.
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => setElapsed(performance.now() - startRef.current), 100);
    return () => window.clearInterval(id);
  }, [phase]);

  // Mystery mode asks for a guess once half the parts are back.
  useEffect(() => {
    if (mystery && phase === "playing" && guess === "pending" && total > 0 && placed >= Math.ceil(total / 2)) {
      setGuess("asking");
    }
  }, [mystery, phase, guess, placed, total]);

  const note = useCallback((text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash((f) => (f === text ? "" : f)), 1600);
  }, []);

  const start = useCallback(() => {
    if (phase !== "ready") return;
    startRef.current = performance.now();
    engineRef.current?.shatter();
    setPhase("playing");
  }, [phase]);

  const useHint = useCallback(() => {
    if (phase !== "playing") return;
    if (engineRef.current?.hint()) {
      setHints((h) => h + 1);
      setPenalty((p) => p + HINT_COST);
      note("+10 seconds");
    }
  }, [phase, note]);

  const toggleReference = useCallback(() => {
    if (difficulty === "hard") return;
    setReference((r) => {
      engineRef.current?.setReference(!r);
      return !r;
    });
  }, [difficulty]);

  const cycleFinish = useCallback(() => {
    setFinish((f) => {
      const next: Finish = f === "original" ? "clay" : f === "clay" ? "wire" : "original";
      engineRef.current?.setFinish(next);
      return next;
    });
  }, []);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    sfx.setMuted(m);
    localStorage.setItem("dt.muted", m ? "1" : "0");
  };

  const answer = (name: string) => {
    if (name === object.name) {
      setGuess("right");
      setPenalty((p) => p - GUESS_BONUS);
      note("Correct, 15 seconds off");
    } else {
      setGuess("wrong");
      note("Not that");
    }
  };

  // Keyboard: space to start, H for a hint, R for the reference.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space" && phase === "ready") {
        e.preventDefault();
        start();
      } else if (e.key.toLowerCase() === "h") useHint();
      else if (e.key.toLowerCase() === "r") toggleReference();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, start, useHint, toggleReference]);

  const loadBoard = useCallback(async () => {
    const res = await fetch(`/api/scores?object=${object.id}`);
    if (res.ok) setBoard(((await res.json()) as Score[]).filter((s) => s.difficulty === difficulty));
  }, [object.id, difficulty]);

  // On completion: show it working, record the streak, load the board.
  useEffect(() => {
    if (phase !== "done") return;
    void engineRef.current?.playPayoff(members.map((m) => m.rig));
    if (daily) {
      const days = [...new Set([...readDays(), daily.date])].slice(-400);
      localStorage.setItem("dt.days", JSON.stringify(days));
      setStreak(streakFrom(days));
    }
    void loadBoard();
  }, [phase, daily, members, loadBoard]);

  const save = async () => {
    if (saving || saved) return;
    setSaving(true);
    const name = nickname.trim() || "Anonymous";
    localStorage.setItem("dt.name", name);
    const res = await fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objectId: object.id,
        difficulty,
        name,
        ms: Math.max(1500, finalMs),
        moves,
        hints,
        mystery,
        timeline: timelineRef.current.map(Math.round),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(await res.json());
      void loadBoard();
    } else {
      note("Could not save that time");
    }
  };

  const challengeUrl = () => {
    const base = `${window.location.origin}/play/${object.id}`;
    return saved ? `${base}?vs=${saved.score.id}` : base;
  };

  const shareText = () => {
    const what = daily ? `Daily Teardown No. ${daily.number}` : mystery ? "a mystery object" : `a ${object.name.toLowerCase()}`;
    return `I rebuilt ${what} from loose parts in ${formatTime(finalMs)}. Beat my time:`;
  };

  const shareOnX = () => {
    const url = `https://x.com/intent/post?text=${encodeURIComponent(shareText())}&url=${encodeURIComponent(challengeUrl())}&hashtags=Manycorehackathon`;
    window.open(url, "_blank", "noopener");
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(challengeUrl());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadCard = async () => {
    const shot = engineRef.current?.snapshot();
    if (!shot) return;
    const img = new Image();
    img.src = shot;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 630;
    const g = c.getContext("2d")!;
    const s = Math.max(c.width / img.width, c.height / img.height);
    g.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
    const shade = g.createLinearGradient(0, 0, 620, 0);
    shade.addColorStop(0, "rgba(15,32,28,0.88)");
    shade.addColorStop(1, "rgba(15,32,28,0)");
    g.fillStyle = shade;
    g.fillRect(0, 0, c.width, c.height);
    await document.fonts.ready;
    const display = getComputedStyle(document.documentElement).getPropertyValue("--font-display") || "sans-serif";
    g.fillStyle = "#f4c430";
    g.font = `600 34px ${display}`;
    g.fillText(daily ? `Daily Teardown No. ${daily.number}` : "Daily Teardown", 64, 110);
    g.fillStyle = "#f1f4ec";
    g.font = `600 84px ${display}`;
    g.fillText(object.name, 64, 210);
    g.font = `600 190px ${display}`;
    g.fillText(formatTime(finalMs), 58, 420);
    g.font = `500 34px ${display}`;
    g.fillText(`${total} parts, ${moves} moves, ${hints} ${hints === 1 ? "hint" : "hints"}, ${difficulty}`, 64, 492);
    g.fillStyle = "#f4c430";
    g.fillText("Can you rebuild it faster?", 64, 560);
    const a = document.createElement("a");
    a.download = `teardown-${object.id}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  };

  const downloadPlate = () => {
    const blob = engineRef.current?.exportPlate(object.sizeMm ?? 120);
    if (!blob) return;
    const a = document.createElement("a");
    a.download = `${object.name.toLowerCase().replace(/\s+/g, "-")}-parts.stl`;
    a.href = URL.createObjectURL(blob);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const again = () => {
    // Changing nothing but forcing a reload: reuse the load effect via a fresh engine load.
    setPhase("loading");
    void engineRef.current?.load(members, difficulty).then((info) => {
      setTotal(info.total);
      setPlaced(0);
      setMoves(0);
      setHints(0);
      setPenalty(0);
      setElapsed(0);
      setGuess("pending");
      setSaved(null);
      setReference(false);
      timelineRef.current = [];
      setPhase("ready");
    });
  };

  const rivalPlaced = rival ? rival.timeline.filter((t) => t <= elapsed).length : 0;
  const rivalTotal = rival?.timeline.length ?? 0;
  const dateLabel = daily
    ? new Date(`${daily.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    : "";

  return (
    <div className="game" data-phase={phase}>
      <canvas ref={canvasRef} className="game-canvas" aria-label={`3D view of ${title}`} />

      {phase === "loading" && (
        <div className="game-status" role="status">
          <p>Setting out the parts…</p>
          <div
            className="loadbar"
            role="progressbar"
            aria-label="Loading the objects"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(loaded * 100)}
          >
            <span style={{ transform: `scaleX(${Math.max(0.03, loaded)})` }} />
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="panel panel-start">
          <h1 className="display">This one won’t come apart</h1>
          <p className="lede">{error}</p>
          <Link className="btn btn-primary" href="/archive">
            Pick another object
          </Link>
        </div>
      )}

      {phase === "ready" && (
        <div className="panel panel-start">
          <p className="kicker">
            {daily ? `No. ${daily.number}, ${dateLabel}` : object.author ? `A challenge from ${object.author}` : "Challenge"}
          </p>
          <h1 className={isBench ? "display display-long" : "display"}>{title}</h1>
          {rival ? (
            <p className="lede">
              {rival.name} rebuilt this in <strong>{formatTime(rival.ms)}</strong> on {rival.difficulty}. Their run plays
              alongside yours.
            </p>
          ) : (
            <p className="lede">
              {isBench
                ? `${members.length} objects, ${partCount} parts, one pile. Work out what belongs where and rebuild them all against the clock.`
                : `${partCount} parts. It falls to pieces, you put it back together, and the clock runs the whole time.`}
            </p>
          )}

          <fieldset className="levels" disabled={Boolean(rival)}>
            <legend className="sr-only">Difficulty</legend>
            {LEVELS.map((l) => (
              <label key={l.id} className={difficulty === l.id ? "level is-on" : "level"}>
                <input type="radio" name="level" checked={difficulty === l.id} onChange={() => setDifficulty(l.id)} />
                <span className="level-name">{l.label}</span>
                <span className="level-note">
                  {Math.max(1, Math.min(l.loose, partCount - members.length))} loose parts{l.note ? `, ${l.note}` : ""}
                </span>
              </label>
            ))}
          </fieldset>

          {!isBench && (
            <label className="check">
              <input type="checkbox" checked={mystery} onChange={(e) => setMystery(e.target.checked)} />
              <span>Mystery mode. The name stays hidden; guess it halfway for 15 seconds off.</span>
            </label>
          )}

          <div className="start-row">
            <button className="btn btn-primary btn-big" onClick={start}>
              Take it apart
            </button>
            {daily && streak > 0 && (
              <span className="streak" title="Days in a row you have finished the daily object">
                {streak}-day streak
              </span>
            )}
          </div>
          <p className="fineprint">
            Drag to look around. Space starts, H gives a hint, R shows the reference.{" "}
            <button className="link" onClick={() => setShowMade(true)}>
              How this object was made
            </button>
          </p>
        </div>
      )}

      {(phase === "playing" || phase === "done") && (
        <div className="hud-top">
          <div className="hud-name">
            <span className="hud-title">{title}</span>
            <span className="hud-sub">
              {placed} of {total} placed, {moves} {moves === 1 ? "move" : "moves"}
            </span>
          </div>
          <div className={phase === "done" ? "clock is-final" : "clock"} role="timer" aria-live="off">
            {formatTime(finalMs)}
          </div>
          <div className="hud-flash" aria-live="polite">
            {flash}
          </div>
        </div>
      )}

      {phase === "playing" && rival && (
        <div className="race" aria-label="Race progress">
          <div className="race-row">
            <span>You</span>
            <div className="race-track">
              <i style={{ width: `${(placed / Math.max(1, total)) * 100}%` }} />
            </div>
            <b>{placed}</b>
          </div>
          <div className="race-row is-rival">
            <span>{rival.name}</span>
            <div className="race-track">
              <i style={{ width: `${(rivalPlaced / Math.max(1, rivalTotal)) * 100}%` }} />
            </div>
            <b>{rivalPlaced}</b>
          </div>
        </div>
      )}

      {phase === "playing" && guess === "asking" && (
        <div className="guess" role="group" aria-label="Guess the object">
          <p>What is it?</p>
          {choices.map((c) => (
            <button key={c} className="btn btn-paper" onClick={() => answer(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {phase === "playing" && (
        <div className="toolbar">
          <button className="tool" onClick={useHint}>
            <span>Hint</span>
            <small>adds 10 seconds</small>
          </button>
          <button className="tool" onClick={toggleReference} aria-pressed={reference} disabled={difficulty === "hard"}>
            <span>Reference</span>
            <small>{difficulty === "hard" ? "off on hard" : reference ? "showing" : "hidden"}</small>
          </button>
          <button className="tool" onClick={cycleFinish}>
            <span>Finish</span>
            <small>{finish}</small>
          </button>
          <button className="tool" onClick={toggleMute} aria-pressed={!muted}>
            <span>Sound</span>
            <small>{muted ? "off" : "on"}</small>
          </button>
        </div>
      )}

      {phase === "done" && (
        <aside className="panel panel-result">
          <p className="kicker">{members.some((m) => m.rig || m.source === "practice") ? "Rebuilt, and it works" : "Rebuilt"}</p>
          <h2 className="display result-name">{object.name}</h2>
          <p className="result-time">{formatTime(finalMs)}</p>
          <p className="result-meta">
            {total} parts, {moves} {moves === 1 ? "move" : "moves"}, {hints} {hints === 1 ? "hint" : "hints"}
            {guess === "right" ? ", guessed it" : ""}
            {rival ? (finalMs < rival.ms ? `. You beat ${rival.name} by ${formatTime(rival.ms - finalMs)}.` : `. ${rival.name} still leads by ${formatTime(finalMs - rival.ms)}.`) : ""}
          </p>
          {daily && streak > 0 && <p className="streak">{streak}-day streak</p>}

          {saved ? (
            <p className="rank">
              {saved.rank === 1 ? "Fastest so far" : `Place ${saved.rank} of ${saved.of}`} on {difficulty}
            </p>
          ) : (
            <form
              className="save"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label htmlFor="nick" className="sr-only">
                Your name for the leaderboard
              </label>
              <input id="nick" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={18} placeholder="Your name" />
              <button className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save my time"}
              </button>
            </form>
          )}

          <div className="actions">
            <button className="btn btn-paper" onClick={shareOnX}>
              Post on X
            </button>
            <button className="btn btn-paper" onClick={copyLink}>
              {copied ? "Link copied" : saved ? "Copy race link" : "Copy link"}
            </button>
            <button className="btn btn-ghost" onClick={downloadCard}>
              Save result card
            </button>
            <button className="btn btn-ghost" onClick={downloadPlate}>
              Print the parts (STL)
            </button>
            <button className="btn btn-ghost" onClick={() => setShowMade(true)}>
              How it was made
            </button>
            <button className="btn btn-ghost" onClick={again}>
              Play again
            </button>
          </div>

          {board.length > 0 && (
            <ol className="board">
              {board.slice(0, 6).map((s, i) => (
                <li key={s.id} className={saved?.score.id === s.id ? "is-me" : undefined}>
                  <span className="board-rank">{i + 1}</span>
                  <span className="board-name">{s.name}</span>
                  <span className="board-time">{formatTime(s.ms)}</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      )}

      {showMade && <HowItWasMade objects={members} onClose={() => setShowMade(false)} />}
    </div>
  );
}
