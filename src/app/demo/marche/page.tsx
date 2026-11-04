import { MarketView } from "@/components/market/market-view";
import { demoContext } from "@/lib/demo-page";

export const metadata = { title: "Marché (démo)" };
export const maxDuration = 60;

export default async function DemoMarketPage({ searchParams }: { searchParams: Promise<{ metier?: string }> }) {
  const { metier } = await searchParams;
  const { db, userId } = await demoContext();
  return <MarketView db={db} userId={userId} base="/demo" metier={metier} />;
}
