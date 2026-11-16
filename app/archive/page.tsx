import Link from "next/link";
import { getDaily, listObjects, listScores } from "@/lib/server/store";
import { formatTime } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "All objects — Daily Teardown" };

export default async function Archive() {
  const [objects, daily] = await Promise.all([listObjects(), getDaily()]);
  const best = await Promise.all(objects.map(async (o) => (await listScores(o.id))[0] ?? null));
  const made = objects.filter((o) => o.source === "lux3d");

  return (
    <main className="page">
      <h1 className="display">Everything you can take apart</h1>
      <p className="lede">
        {made.length > 0
          ? `${made.length} made from photos with Lux3D, plus ${objects.length - made.length} practice objects.`
          : "Only practice objects so far. The first object made from a photo will appear at the top."}
      </p>

      <ul className="shelf">
        {objects.map((o, i) => (
          <li key={o.id}>
            <Link href={o.id === daily.object.id ? "/" : `/play/${o.id}`} className="tag">
              {o.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.photoUrl} alt="" className="tag-photo" />
              ) : (
                <span className="tag-photo tag-blank" aria-hidden="true">
                  {o.name.slice(0, 1)}
                </span>
              )}
              <span className="tag-body">
                <span className="tag-name">{o.name}</span>
                <span className="tag-meta">
                  {o.id === daily.object.id
                    ? "Today's object"
                    : o.source === "practice"
                      ? "Practice object"
                      : o.author
                        ? `Made by ${o.author}`
                        : "Made with Lux3D"}
                </span>
                <span className="tag-best">
                  {best[i] ? `Fastest: ${formatTime(best[i]!.ms)} by ${best[i]!.name}` : "No times yet. Set the first."}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
