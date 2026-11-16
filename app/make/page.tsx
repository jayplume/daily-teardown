"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Job, JobStatus } from "@/lib/types";

const STAGES: { id: JobStatus; title: string; note: string }[] = [
  { id: "queued", title: "Waiting for a turn", note: "Lux3D builds one object at a time" },
  { id: "generating", title: "Building the 3D model", note: "about two minutes" },
  { id: "painting", title: "Painting the new material", note: "only if you added a second photo" },
  { id: "splitting", title: "Splitting it into parts", note: "these become the puzzle pieces" },
  { id: "animating", title: "Working out how it moves", note: "the reward for rebuilding it" },
  { id: "saving", title: "Putting it on the shelf", note: "" },
];

export default function Make() {
  const router = useRouter();
  const [canMake, setCanMake] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"photo" | "words">("photo");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [seconds, setSeconds] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    fetch("/api/objects")
      .then((r) => r.json())
      .then((d) => setCanMake(Boolean(d.canMake)))
      .catch(() => setCanMake(false));
  }, []);

  // Follow the build until it finishes.
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const poll = window.setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`);
      const next = (await res.json()) as Job & { error?: string };
      if (!res.ok) setJob({ ...job, status: "failed", error: next.error });
      else setJob(next);
    }, 2000);
    const tick = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [job]);

  useEffect(() => {
    if (job?.status === "done" && job.objectId) {
      const t = window.setTimeout(() => router.push(`/play/${job.objectId}`), 1200);
      return () => window.clearTimeout(t);
    }
  }, [job, router]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSending(true);
    const data = new FormData(e.currentTarget);
    if (mode === "words") data.delete("photo");
    else data.delete("prompt");
    const admin = new URLSearchParams(window.location.search).get("admin");
    if (admin) data.set("admin", admin);
    const res = await fetch("/api/make", { method: "POST", body: data });
    const body = await res.json();
    setSending(false);
    if (!res.ok) return setError(body.error ?? "That did not work. Try again.");
    setSeconds(0);
    setJob(body as Job);
  };

  if (job) {
    const active = STAGES.findIndex((s) => s.id === job.status);
    return (
      <main className="page page-narrow">
        {job.status === "failed" ? (
          <>
            <h1 className="display">The build stopped</h1>
            <p className="lede">{job.error ?? "Lux3D could not finish this object."}</p>
            <button className="btn btn-primary" onClick={() => setJob(null)}>
              Change it and try again
            </button>
          </>
        ) : job.status === "done" ? (
          <>
            <h1 className="display">It’s ready to take apart</h1>
            <p className="lede">Opening your puzzle…</p>
            <Link className="btn btn-primary" href={`/play/${job.objectId}`}>
              Play it now
            </Link>
          </>
        ) : (
          <>
            <h1 className="display">Building your puzzle</h1>
            <p className="lede">
              {job.status === "queued" && job.ahead > 0
                ? `${job.ahead} ${job.ahead === 1 ? "build is" : "builds are"} ahead of yours.`
                : `${seconds} seconds so far. Most objects take five to eight minutes.`}{" "}
              You can leave this page open in another tab.
            </p>
            <ol className="progress">
              {STAGES.map((s, i) => (
                <li key={s.id} className={i < active ? "is-done" : i === active ? "is-now" : undefined}>
                  <strong>{s.title}</strong>
                  {s.note && <span>{s.note}</span>}
                </li>
              ))}
            </ol>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="page page-narrow">
      <h1 className="display">Turn anything into a puzzle</h1>
      <p className="lede">
        Photograph something on your desk. Lux3D builds it in 3D, splits it into its parts and works out how it moves.
        Then send the link to someone and see who rebuilds it faster.
      </p>

      {canMake === false && (
        <p className="notice">
          Making objects is switched off on this server because it has no Lux3D key yet. You can still play every object
          on the <Link href="/archive">shelf</Link>.
        </p>
      )}

      <form ref={formRef} className="form" onSubmit={submit}>
        <div className="segmented" role="tablist" aria-label="Start from">
          <button type="button" role="tab" aria-selected={mode === "photo"} onClick={() => setMode("photo")}>
            From a photo
          </button>
          <button type="button" role="tab" aria-selected={mode === "words"} onClick={() => setMode("words")}>
            From a description
          </button>
        </div>

        {mode === "photo" ? (
          <label className="drop">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Your photo" />
            ) : (
              <span>
                <strong>Choose a photo</strong>
                One object, plain background, the whole thing in frame.
              </span>
            )}
            <input
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : "");
              }}
            />
          </label>
        ) : (
          <label className="field">
            <span>Describe the object</span>
            <textarea name="prompt" rows={3} maxLength={300} placeholder="A red stovetop espresso maker with a black handle" />
          </label>
        )}

        <label className="field">
          <span>What is it called?</span>
          <input name="name" maxLength={40} required placeholder="Espresso maker" />
          <small>Players in mystery mode have to guess this.</small>
        </label>

        <label className="field">
          <span>How does it move?</span>
          <input name="motion" maxLength={200} placeholder="The lid flips open" />
          <small>Optional. It plays when someone finishes rebuilding it.</small>
        </label>

        <details className="more">
          <summary>More options</summary>
          <label className="field">
            <span>Paint it like another photo</span>
            <input type="file" name="skin" accept="image/jpeg,image/png,image/webp" />
            <small>Optional. Lux3D copies the material from this photo onto your object.</small>
          </label>
          <label className="field">
            <span>Your name</span>
            <input name="author" maxLength={18} placeholder="Shown on the challenge" />
          </label>
        </details>

        {error && (
          <p className="notice is-error" role="alert">
            {error}
          </p>
        )}

        <button className="btn btn-primary btn-big" disabled={sending || canMake === false}>
          {sending ? "Sending…" : "Build my puzzle"}
        </button>
      </form>
    </main>
  );
}
