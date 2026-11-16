import { Game } from "@/components/Game";
import { decoysFor, getDaily, listObjects, membersOf } from "@/lib/server/store";
import { todayISO } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ object, number }, all] = await Promise.all([getDaily(), listObjects()]);
  const members = await membersOf(object);
  return <Game object={object} members={members} daily={{ number, date: todayISO() }} decoys={decoysFor(object, all)} />;
}
