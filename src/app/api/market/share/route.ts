import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import type { MarketData } from "@/lib/market/compute";

// Freezes today's market into a public card: the figures of the role, nothing from the CV or the
// person's selection. The link is the card's id; it is never listed anywhere.
export async function POST() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { data: last } = await supabase.from("market_snapshots").select("data").eq("profile_id", user.id).eq("role", "").order("day", { ascending: false }).limit(1).maybeSingle();
  if (!last) return NextResponse.json({ error: "Ton marché n'est pas encore prêt." }, { status: 404 });
  const m = last.data as MarketData;
  const card: MarketData = { ...m, mine: 0, skills: m.skills.map((s) => ({ ...s, inCv: false, mine: 0 })) };
  const { data, error } = await supabase.from("market_cards").insert({ profile_id: user.id, data: card }).select("id").single();
  if (error) return NextResponse.json({ error: "Le lien n'a pas pu être créé." }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
