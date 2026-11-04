import { CareersView } from "@/components/careers-view";
import { demoContext } from "@/lib/demo-page";

export const metadata = { title: "Métiers (démo)" };

export default async function DemoCareersPage() {
  const { db, userId } = await demoContext();
  return <CareersView db={db} userId={userId} demo />;
}
