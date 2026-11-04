import { CareersView } from "@/components/careers-view";
import { getUser } from "@/lib/supabase/server";

export const metadata = { title: "Métiers" };

export default async function CareersRoute() {
  const { supabase, user } = await getUser();
  return <CareersView db={supabase} userId={user!.id} />;
}
