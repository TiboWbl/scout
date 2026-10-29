import Link from "next/link";
import type { MarketData } from "@/lib/market/compute";
import { CompanyLogo } from "@/components/company-logo";

const pct = (n: number, total: number) => (total ? Math.round((100 * n) / total) : 0);
const COLORS = ["bg-mint-ink", "bg-sky-ink", "bg-brand", "bg-peach-ink", "bg-violet-ink/50", "bg-line"];

// The experience the offers really ask for, beyond the word "junior".
export function ExperienceBlock({ m }: { m: MarketData }) {
  const stated = m.experience.buckets.filter((b) => !["Non précisée", "Expérimenté, sans durée"].includes(b.label));
  const statedTotal = stated.reduce((a, b) => a + b.count, 0);
  const threePlus = stated.filter((b) => ["3 à 4 ans", "5 ans et plus"].includes(b.label)).reduce((a, b) => a + b.count, 0);
  return (
    <section className="rounded-[22px] border border-line bg-surface p-5 md:p-6">
      <h3 className="font-display text-lg font-bold">L&apos;expérience vraiment demandée</h3>
      {statedTotal > 0 && (
        <p className="mt-1 text-[15px]">
          Quand une offre chiffre l&apos;expérience, <span className="font-semibold">{pct(threePlus, statedTotal)} %</span> demandent 3 ans ou plus.
        </p>
      )}
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-pill-solid">
        {m.experience.buckets.map((b, i) => (
          <span key={b.label} className={COLORS[i % COLORS.length]} style={{ width: `${pct(b.count, m.total)}%` }} title={`${b.label} : ${b.count}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] text-muted">
        {m.experience.buckets.map((b, i) => (
          <li key={b.label} className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${COLORS[i % COLORS.length]}`} />
            <span>
              {b.label} · {pct(b.count, m.total)} %
            </span>
          </li>
        ))}
      </ul>
      {m.experience.juniorLabeled >= 5 && (
        <p className="mt-4 rounded-xl bg-pill-solid px-3.5 py-2.5 text-[13.5px]">
          Sur {m.experience.juniorLabeled} offres affichées « junior », {m.experience.juniorAsking2} demandent quand même 2 ans ou plus.
        </p>
      )}
    </section>
  );
}

export function SalaryBlock({ m }: { m: MarketData }) {
  const rows = [
    ["Débutant", m.salaries.junior],
    ["Confirmé (3 ans et plus)", m.salaries.experienced],
  ] as const;
  return (
    <section className="rounded-[22px] border border-line bg-surface p-5 md:p-6">
      <h3 className="font-display text-lg font-bold">Les salaires affichés</h3>
      <p className="mt-1 text-[15px]">
        <span className="font-semibold">{pct(m.salaries.n, m.total)} %</span> des offres donnent un salaire.
      </p>
      <ul className="mt-4 space-y-3">
        {rows.map(([label, r]) => (
          <li key={label} className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="text-muted">{label}</span>
            {r ? (
              <span className="text-right">
                <span className="font-display text-xl font-bold tabular-nums">{r.median} k€</span>
                <span className="block text-[12.5px] text-muted tabular-nums">
                  la moitié entre {r.low} et {r.high} k€ · {r.n} offres
                </span>
              </span>
            ) : (
              <span className="text-[13px] text-muted">Trop peu d&apos;offres pour le dire</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12.5px] text-muted">Brut annuel, tel qu&apos;écrit dans les offres.</p>
    </section>
  );
}

export function RemoteBlock({ m }: { m: MarketData }) {
  const said = m.remote.remote + m.remote.hybrid + m.remote.onsite;
  return (
    <section className="rounded-[22px] border border-line bg-surface p-5 md:p-6">
      <h3 className="font-display text-lg font-bold">Le télétravail</h3>
      <p className="mt-1 text-[15px]">Parmi les offres qui en parlent ({pct(said, m.total)} %) :</p>
      <ul className="mt-4 space-y-2.5 text-[14px]">
        {(
          [
            ["Hybride", m.remote.hybrid],
            ["Télétravail complet", m.remote.remote],
            ["Sur site", m.remote.onsite],
          ] as const
        ).map(([label, n]) => (
          <li key={label} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-3">
            <span>{label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-pill-solid">
              <span className="block h-full rounded-full bg-sky-ink" style={{ width: `${pct(n, said)}%` }} />
            </span>
            <span className="text-right tabular-nums text-muted">{pct(n, said)} %</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CompaniesBlock({ m, base = "", linked = true }: { m: MarketData; base?: string; linked?: boolean }) {
  if (m.companies.length === 0) return null;
  return (
    <section>
      <h2 className="font-display text-2xl font-bold">Qui recrute en ce moment</h2>
      <p className="mt-1 text-sm text-muted">Le plus d&apos;offres de ton métier ces 30 derniers jours.</p>
      <ul className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {m.companies.map((c) => {
          const body = (
            <>
              <CompanyLogo name={c.name} domain={c.domain} brand={c.brand} size={36} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="block text-[13px] text-muted">{c.recent > 1 ? `${c.recent} offres` : "1 offre"}</span>
              </span>
            </>
          );
          return (
            <li key={c.id}>
              {linked ? (
                <Link href={`${base}/offres?q=${encodeURIComponent(c.name)}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 transition-shadow hover:shadow-md">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const CONTRACT_NAMES: [string, string][] = [
  ["cdi", "CDI"],
  ["stage", "Stage"],
  ["alternance", "Alternance"],
  ["cdd", "CDD"],
  ["freelance", "Freelance"],
  ["vie", "V.I.E."],
];

// How the role's offers are offered: useful to decide whether to widen the contracts sought.
export function ContractsBlock({ m }: { m: MarketData }) {
  const c = m.contracts ?? {};
  const said = Object.values(c).reduce((a, b) => a + b, 0);
  if (said < 10) return null;
  return (
    <section className="rounded-[22px] border border-line bg-surface p-5 md:p-6">
      <h3 className="font-display text-lg font-bold">Les contrats proposés</h3>
      <p className="mt-1 text-[15px]">Parmi les offres qui le précisent :</p>
      <ul className="mt-4 space-y-2.5 text-[14px]">
        {CONTRACT_NAMES.filter(([k]) => c[k]).map(([k, label]) => (
          <li key={k} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-3">
            <span>{label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-pill-solid">
              <span className="block h-full rounded-full bg-peach-ink" style={{ width: `${pct(c[k], said)}%` }} />
            </span>
            <span className="text-right tabular-nums text-muted">{pct(c[k], said)} %</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
