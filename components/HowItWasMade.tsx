"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { TeardownObject } from "@/lib/types";

const STEPS = [
  { name: "generate", title: "Photo or sentence to 3D model", tool: "Lux3D G1-Turbo" },
  { name: "paint", title: "Material painted from a second photo", tool: "Lux3D material transfer" },
  { name: "split", title: "Model split into separate parts", tool: "Lux3D part split" },
  { name: "animate", title: "Joints found, so it moves when rebuilt", tool: "Lux3D articulation" },
];

function Made({ object, first }: { object: TeardownObject; first: boolean }) {
  const longest = Math.max(1, ...(object.stages ?? []).map((s) => s.ms));
  const totalMs = (object.stages ?? []).reduce((a, s) => a + s.ms, 0);

  return (
    <div className="made">
        <h2 id={first ? "made-title" : undefined} className="display">
          How this {object.name.toLowerCase()} was made
        </h2>

        {object.source === "practice" ? (
          <>
            <p className="lede">
              This is a practice object, built by hand from simple shapes so there is always something to play. Nobody
              modelled the objects players make: those come from a photo.
            </p>
            <ol className="steps">
              {STEPS.filter((s) => s.name !== "paint").map((s) => (
                <li key={s.name}>
                  <strong>{s.title}</strong>
                  <span>{s.tool}</span>
                </li>
              ))}
            </ol>
            <Link className="btn btn-primary" href="/make">
              Make one from a photo
            </Link>
          </>
        ) : (
          <>
            <p className="lede">
              No one modelled this. It went from {object.photoUrl ? "a single photo" : "one sentence"} to a puzzle in{" "}
              {totalMs >= 90_000 ? `about ${Math.round(totalMs / 60_000)} minutes` : `${Math.round(totalMs / 1000)} seconds`}, entirely
              through Aholo Lux3D.
            </p>
            {object.photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="sheet-photo" src={object.photoUrl} alt={`The photo this ${object.name} was generated from`} />
            )}
            {object.prompt && <p className="quote">“{object.prompt}”</p>}
            <ol className="steps">
              {(object.stages ?? []).map((s) => {
                const def = STEPS.find((d) => d.name === s.name);
                return (
                  <li key={s.name}>
                    <strong>{def?.title ?? s.label}</strong>
                    <span>{def?.tool ?? s.label}</span>
                    <div className="bar">
                      <i style={{ width: `${(s.ms / longest) * 100}%` }} />
                      <b>{(s.ms / 1000).toFixed(0)} s</b>
                    </div>
                  </li>
                );
              })}
            </ol>
            {object.motionPrompt && <p className="fineprint">Motion asked for: “{object.motionPrompt}”</p>}
            {object.wholeUrl && (
              <a className="btn btn-paper" href={object.wholeUrl} download={`${object.name}.glb`}>
                Download the model (GLB)
              </a>
            )}
          </>
        )}
    </div>
  );
}

export function HowItWasMade({ objects, onClose }: { objects: TeardownObject[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="made-title" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          Close
        </button>
        {objects.map((o, i) => (
          <Made key={o.id} object={o} first={i === 0} />
        ))}
      </section>
    </div>
  );
}
