import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireUser } from "@/lib/api";
import { exploreCareers } from "@/lib/careers";
import { Criteria, CvSummary } from "@/lib/domain/criteria";
import { getLlm, LLM_UNAVAILABLE_MESSAGE, LlmUnavailableError } from "@/lib/llm";

export const maxDuration = 60;

const Body = z.object({ text: z.string().trim().min(10).max(2000) });

// Nearby jobs for what the person likes and wants, each with the offers online now and those open to a
// beginner. Only the profile's job-related fields reach the model, never a name or contact details.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("Dis-en un peu plus : ce que tu aimes, ce que tu veux faire.");
  const { data: profile } = await auth.supabase.from("profiles").select("criteria, cv_summary").eq("id", auth.user.id).single();
  const criteria = Criteria.parse(profile?.criteria ?? {});
  const cv = profile?.cv_summary ? (CvSummary.safeParse(profile.cv_summary).data ?? null) : null;
  try {
    const ideas = await exploreCareers(auth.supabase, getLlm(), { text: body.data.text, criteria, cv });
    // Kept for the "Métiers" page, which shows the last exploration again.
    await auth.supabase.from("profiles").update({ career_text: body.data.text, career_ideas: ideas, career_at: new Date().toISOString() }).eq("id", auth.user.id);
    return NextResponse.json({ ideas });
  } catch (error) {
    if (error instanceof LlmUnavailableError) return NextResponse.json({ error: LLM_UNAVAILABLE_MESSAGE }, { status: 503 });
    return NextResponse.json({ error: "La recherche n'a pas abouti, réessaie." }, { status: 500 });
  }
}
