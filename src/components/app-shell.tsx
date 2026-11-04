import { Rail } from "@/components/rail";
import { isAdminEmail } from "@/lib/env";
import type { SessionUser } from "@/lib/supabase/server";

const ITEMS = [
  { href: "/offres", label: "Offres" },
  { href: "/marche", label: "Mon marché" },
  { href: "/metiers", label: "Métiers" },
  { href: "/entreprises", label: "Entreprises" },
  { href: "/suivi", label: "Suivi" },
  { href: "/cv", label: "Mon CV" },
];

// Sidebar + content, shared by the app and by public pages viewed while signed in.
export function AppShell({ user, firstName, todo = 0, children }: { user: SessionUser; firstName: string | null; todo?: number; children: React.ReactNode }) {
  const meta = user.user_metadata;
  const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : typeof meta.picture === "string" ? meta.picture : null;
  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 md:flex-row">
      <Rail items={ITEMS.map((i) => (i.href === "/suivi" ? { ...i, badge: todo } : i))} firstName={firstName} avatarUrl={avatarUrl} isAdmin={isAdminEmail(user.email)} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
