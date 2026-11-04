import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareerIdea } from "@/lib/careers";
import { Criteria } from "@/lib/domain/criteria";
import { CareersPage } from "@/components/careers-page";

// "Métiers": find the job that suits you. The last exploration is shown again, with the date of its counts.
export async function CareersView({ db, userId, demo = false }: { db: SupabaseClient; userId: string; demo?: boolean }) {
  const { data: profile } = await db.from("profiles").select("criteria, career_text, career_ideas, career_at").eq("id", userId).single();
  const criteria = Criteria.parse(profile?.criteria ?? {});
  const sought = [...criteria.targetRoles, ...criteria.titleVariants].slice(0, 3);
  return (
    <div className="px-1 pb-16 pt-3 md:px-2">
      <h1 className="font-display text-4xl font-extrabold tracking-tight md:text-5xl">Trouver ton métier</h1>
      <p className="mt-2 max-w-[68ch] text-[15px] text-muted">
        {sought.length > 0 ? `Tu cherches aujourd'hui ${sought.join(", ")}. ` : ""}
        Un métier voisin peut te correspondre autant, recruter plus de débutants et mener au même endroit. Scout te les propose à partir de ce que tu aimes, et compte leurs offres en ce moment.
      </p>
      <div className="mt-6">
        <CareersPage criteria={criteria} demo={demo} initialText={profile?.career_text ?? ""} initialIdeas={(profile?.career_ideas as CareerIdea[] | null) ?? null} countedAt={profile?.career_at ?? null} />
      </div>
    </div>
  );
}
