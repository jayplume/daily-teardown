import { notFound } from "next/navigation";
import { Game } from "@/components/Game";
import { decoysFor, getObject, getScore, listObjects, membersOf } from "@/lib/server/store";

export const dynamic = "force-dynamic";

interface PlayProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Play(props: PlayProps) {
  const { id } = await props.params;
  const vs = (await props.searchParams).vs;
  const [object, all] = await Promise.all([getObject(id), listObjects()]);
  if (!object) notFound();
  const members = await membersOf(object);
  const rival = typeof vs === "string" ? await getScore(vs) : null;
  return (
    <Game
      key={`${object.id}-${rival?.id ?? "solo"}`}
      object={object}
      members={members}
      rival={rival && rival.objectId === object.id ? rival : null}
      decoys={decoysFor(object, all)}
    />
  );
}
