// What an offer requires and what it only wishes for. A "nice to have" section ("Un plus", "Idéalement",
// "Bonus") or a line that says so ("SQL serait un plus") is a wish; everything else counts as asked.
// Read by rules, never guessed: when the offer makes no difference, everything is required.

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const BONUS = /\b(un plus|en plus|serait (un )?(plus|apprecie|appreciee|bienvenu)|est un plus|appreci|bonus|nice[- ]to[- ]have|ideal(ement)?|atouts?|optionnel|souhaite|souhaitable|preferred|is a plus|would be a plus|a plus\b|pluses|ce qui ferait la difference|points? forts?)/;
const SECTION = /\b(profil|missions?|responsabilit|pourquoi|avantages|process|qui sommes|a propos|about|benefits|ce que|tu es|vous etes|requirements|qualifications|competences|stack|environnement|conditions|infos|plus|nice|bonus|ideal)/;
// A heading: a short line that ends with a colon, or names a usual section. A short item line
// ("Python") is not one, so it never closes the section it belongs to.
const isHeading = (line: string, n: string) => line.split(/\s+/).length <= 9 && !/^[•\-*·]/.test(line) && (/[:：]\s*$/.test(line) || (!/[.!,;]$/.test(line) && SECTION.test(n)));

export function splitRequirements(description: string): { required: string; bonus: string } {
  const required: string[] = [];
  const bonus: string[] = [];
  let inBonus = false;
  for (const raw of description.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const n = fold(line);
    if (isHeading(line, n)) {
      inBonus = BONUS.test(n) || /\bplus\b/.test(n);
      // The heading itself holds no skill worth counting either way.
      (inBonus ? bonus : required).push(line);
      continue;
    }
    if (inBonus || BONUS.test(n)) bonus.push(line);
    else required.push(line);
  }
  return { required: required.join("\n"), bonus: bonus.join("\n") };
}

// Sections about the company or what it offers, not about the job: "Qui sommes-nous", "About us",
// "Avantages", "Pourquoi nous rejoindre", "What we offer", the hiring process.
const NOT_THE_JOB = /\b(qui sommes|qui est|a propos|about (us|the company|[a-z]+$)|l.entreprise$|la societe|notre (entreprise|societe|histoire|mission|culture|equipe)|presentation|who we are|our (company|story|mission|culture|values)|the company|company description|avantages|benefits|perks|pourquoi (nous )?rejoindre|why (join|us)|what we offer|ce que nous (t.|vous )?(offrons|proposons)|on t.offre|nous t.offrons|nous vous offrons|process(us)? de recrutement|recruitment process|hiring process|interview process|deroulement|nos valeurs|our values)\b/;
const SECTION_LIKE = /[:：]\s*$/;

// The part of an offer that describes the job (missions, profile sought), without the company's
// presentation or its perks. An offer without headings is kept whole: nothing tells them apart.
export function roleText(description: string): string {
  const out: string[] = [];
  let skip = false;
  let removed = false;
  for (const raw of description.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const n = fold(line).replace(/[:：.!?]\s*$/, "").trim();
    if (line.split(/\s+/).length <= 9 && !/^[•\-*·]/.test(line) && (SECTION_LIKE.test(line) || isHeading(line, n) || NOT_THE_JOB.test(n))) {
      skip = NOT_THE_JOB.test(n);
      if (skip) {
        removed = true;
        continue;
      }
    }
    if (!skip) out.push(line);
  }
  if (!removed) return description;
  const kept = out.join("\n");
  // A heading misread as "about the company" must not erase the offer.
  return kept.length >= 300 ? kept : description;
}
