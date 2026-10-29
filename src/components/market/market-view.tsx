import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Criteria } from "@/lib/domain/criteria";
import type { Insight, MarketInsights } from "@/lib/market/advice";
import { marketPage } from "@/lib/market/view";
import { CompaniesBlock, ContractsBlock, ExperienceBlock, RemoteBlock, SalaryBlock } from "./blocks";
import { MarketSkills } from "./skills";
import { ShareMarket } from "./share";

// Below this, one offer moves a share by a point or more: counts are shown beside the shares.
const SMALL_MARKET = 100;
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

// The market of the role sought: what the offers really ask for, how it moves, what it means for the
// person this week. Counted in the offers themselves, every figure can be checked.
export async function MarketView({ db, userId, base = "" }: { db: SupabaseClient; userId: string; base?: string }) {
  const page = await marketPage(db, userId);
  if (!page) {
    return (
      <div className="px-1 pb-16 pt-3 md:px-2">
        <h1 className="font-display text-4xl font-extrabold md:text-5xl tracking-tight">Ton marché</h1>
        <p className="mt-4 rounded-2xl bg-surface p-6 text-muted">Dis à Scout quel métier tu cherches, et il te montre ce que ses offres demandent vraiment.</p>
      </div>
    );
  }
  const { today: m, trend, since, insights, cvKnown } = page;
  // What "your market" covers: the role and the titles counted as the same job.
  const { data: profile } = await db.from("profiles").select("criteria").eq("id", userId).single();
  const variants = (Criteria.safeParse(profile?.criteria).data?.titleVariants ?? []).filter((v) => v.toLowerCase() !== m.role.toLowerCase()).slice(0, 4);
  const demoCard = base ? ((await db.from("market_cards").select("id").eq("profile_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data?.id as string | undefined) : undefined;
  return (
    <div className="px-1 pb-16 pt-3 md:px-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold md:text-5xl tracking-tight">Ton marché : {m.role}</h1>
          <p className="mt-2 max-w-[68ch] text-[15px] text-muted">
            Les offres de {m.role}
            {variants.length > 0 ? ` et des intitulés équivalents (${variants.join(", ")})` : ""} en France, tous niveaux et contrats confondus :{" "}
            <span className="font-semibold text-ink">{m.total.toLocaleString("fr-FR")} en ligne</span>, dont {m.newThisWeek} publiées cette semaine.
          </p>
          {m.total < SMALL_MARKET && (
            <p className="mt-2 max-w-3xl rounded-xl bg-pill-solid px-3.5 py-2.5 text-[14px]">
              Un petit marché : chaque offre pèse {Math.max(1, Math.round(100 / Math.max(1, m.total)))} % ou plus. Les tendances fortes sont fiables, les petits écarts beaucoup moins : le nombre d&apos;offres est indiqué à côté de chaque part.
            </p>
          )}
        </div>
        {base ? demoCard && <ShareMarket demoCard={demoCard} /> : <ShareMarket />}
      </div>

      {insights.coverage.of > 0 &&
        (cvKnown ? (
          <CvAgainstMarket insights={insights} mine={m.mine} small={m.total < SMALL_MARKET} />
        ) : (
          <section className="mt-8 rounded-[22px] border border-line bg-surface p-5 md:p-7">
            <h2 className="font-display text-2xl font-bold">Ton CV face au marché</h2>
            <p className="mt-1 max-w-2xl text-[15px] text-muted">
              Pour savoir lesquelles des {insights.coverage.of} compétences les plus demandées ton CV cite déjà, analyse-le : Scout y relève chaque compétence mot pour mot.
            </p>
            <Link href={`${base}/cv`} className="btn-soft mt-4 inline-flex">
              Analyser mon CV
            </Link>
          </section>
        ))}

      <section className="mt-4 rounded-[22px] border border-line bg-surface p-5 md:p-7">
        <h2 className="font-display text-2xl font-bold">Ce que demandent les offres</h2>
        <p className="mb-5 mt-1 text-sm text-muted">
          La part des offres qui citent chaque compétence.{since ? ` Évolution depuis le ${day(since)}.` : ""}
        </p>
        <MarketSkills skills={m.skills} trend={trend} mine={m.mine} personal since={since ? day(since) : null} small={m.total < SMALL_MARKET} />
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <ExperienceBlock m={m} />
        <SalaryBlock m={m} />
        <ContractsBlock m={m} />
        <RemoteBlock m={m} />
      </div>

      <div className="mt-10">
        <CompaniesBlock m={m} base={base} />
      </div>
    </div>
  );
}

// The CV against the market: how much of what is most asked it shows, then three short lists to act
// on. Each line says the share of the role's offers, and how many of the person's own offers.
function CvAgainstMarket({ insights, mine, small }: { insights: MarketInsights; mine: number; small: boolean }) {
  const { coverage, add, show, plus } = insights;
  const columns = [
    { title: `À ajouter, si c'est vrai pour toi · ${add.length}`, hint: "Écris-le tel quel, dans une mission.", items: add, tone: "bg-peach-soft text-peach-ink", note: (i: Insight) => `${i.share} % des offres${small ? ` (${i.count})` : ""}${mine ? ` · ${i.mine} des tiennes` : ""}${i.plusShare >= 40 ? " · souvent un plus" : ""}` },
    { title: `Déjà dans ton CV, à mettre en valeur · ${show.length}`, hint: "Montre-le dans une mission, avec un résultat.", items: show, tone: "bg-mint-soft text-mint-ink", note: (i: Insight) => `${i.share} % des offres${small ? ` (${i.count})` : ""}` },
    { title: "Un plus, pas une condition", hint: "D'autres compétences, surtout demandées en bonus : leur absence ne doit pas t'arrêter.", items: plus, tone: "bg-violet-soft text-violet-ink", note: (i: Insight) => `« un plus » dans ${i.plusShare} % des cas` },
  ].filter((c) => c.items.length > 0);
  return (
    <section className="mt-8 rounded-[22px] border border-line bg-surface p-5 md:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold">Ton CV face au marché</h2>
          <p className="mt-1 text-sm text-muted">Les {coverage.of} compétences les plus demandées dans ton métier, comparées à ton CV.</p>
        </div>
        <p className="text-right">
          <span className="font-display text-4xl font-extrabold tabular-nums">
            {coverage.have}
            <span className="text-2xl text-muted">/{coverage.of}</span>
          </span>
          <span className="block text-[13px] text-muted">dans ton CV</span>
        </p>
      </div>
      {add.length === 0 && (
        <p className="mt-5 rounded-2xl bg-mint-soft px-4 py-3 text-[14.5px] text-mint-ink">
          <span className="font-semibold">Ton CV cite toutes les compétences les plus demandées.</span> Il reste à les prouver : chacune dans une mission, avec un résultat.
        </p>
      )}
      <div className={`mt-5 grid grid-cols-1 gap-4 ${columns.length === 3 ? "lg:grid-cols-3" : columns.length === 2 ? "lg:grid-cols-2" : ""}`}>
        {columns.map((c) => (
          <div key={c.title} className="rounded-2xl bg-pill-solid p-4">
            <h3 className="font-display text-base font-bold">{c.title}</h3>
            <p className="text-[12.5px] text-muted">{c.hint}</p>
            <ul className="mt-3 space-y-2">
              {c.items.map((i) => (
                <li key={i.name} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[14px]">
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 font-semibold ${c.tone}`}>{i.name}</span>
                  <span className="text-right text-[12.5px] tabular-nums text-muted">{c.note(i)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
