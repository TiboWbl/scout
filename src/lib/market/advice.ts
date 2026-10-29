import type { MarketData, MarketSkill } from "./compute";
import { skillLabel } from "@/lib/views/skills";

// The person's CV against their market, built from the figures themselves (never written by the
// model): what the most asked skills are, which the CV shows, which to add if true, which are only
// a plus. Every number is the one Scout counted.

export type Insight = { name: string; key: string; kind: MarketSkill["kind"]; share: number; count: number; mine: number; plusShare: number };
export type MarketInsights = {
  coverage: { have: number; of: number };
  add: Insight[];
  show: Insight[];
  plus: Insight[];
};

const TOP = 12;
const plusShare = (s: MarketSkill) => (s.count ? Math.round((100 * (s.bonus ?? 0)) / s.count) : 0);
const insight = (s: MarketSkill): Insight => ({ name: skillLabel(s.name), key: s.key ?? "", kind: s.kind, share: s.share, count: s.count, mine: s.mine, plusShare: plusShare(s) });

// `steady`: each skill's average share over the last two weeks. The twelve are chosen on it, so the list
// (and the CV check built on it) does not change with a few offers posted or taken down in a day.
export function marketInsights(m: MarketData, steady?: Record<string, number>): MarketInsights {
  // The skills that weigh in this market: tools and methods asked by at least 5 % of the offers,
  // and the languages asked by at least 15 %.
  // At least 3 offers each: on a small market, two offers would already make 5 %.
  const weight = (s: MarketSkill) => steady?.[s.key ?? ""] ?? s.share;
  const hard = m.skills.filter((s) => s.count >= 3 && (((s.kind === "outil" || s.kind === "methode") && s.share >= 5) || (s.kind === "langue" && s.share >= 15))).sort((a, b) => weight(b) - weight(a));
  const top = hard.slice(0, TOP);
  const mostlyPlus = (s: MarketSkill) => s.count >= 10 && plusShare(s) >= 40;
  return {
    coverage: { have: top.filter((s) => s.inCv).length, of: top.length },
    // The two lists together are exactly the twelve skills counted, most asked first.
    add: top.filter((s) => !s.inCv).map(insight),
    show: top.filter((s) => s.inCv).map(insight),
    // Beyond the twelve: skills the CV lacks that the offers mostly ask as a plus.
    plus: hard.slice(TOP).filter((s) => !s.inCv && mostlyPlus(s)).slice(0, 3).map(insight),
  };
}
