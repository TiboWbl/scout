import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: ["600", "700", "800"] });

// Vercel exposes the production domain; share images need absolute URLs.
const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  // Each page names itself: "Offres · Scout".
  // Just the page name in the tab: the icon already says it is Scout.
  title: { default: "Scout", template: "%s" },
  description: "Les offres lues à la source, sur les sites carrière et les API publiques, triées et expliquées pour toi, avec ce que ton marché demande vraiment, compté offre par offre.",
  // Google Search Console proof of ownership, needed for the brand verification of the Google sign-in screen.
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } } : {}),
};

const THEME_SCRIPT = `try{var t=localStorage.getItem("scout-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme picked in Paramètres is applied before the first paint (no flash of the other theme).
    <html lang="fr" suppressHydrationWarning className={`${inter.variable} ${bricolage.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
