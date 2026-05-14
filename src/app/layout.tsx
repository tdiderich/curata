import type { Metadata } from "next";
import { resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { ThemeScript } from "@/components/theme-script";
import "./kazam.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "curata",
  description: "Where your AI work lives",
  metadataBase: new URL("https://curata.ai"),
  openGraph: {
    title: "curata",
    description: "Where your AI work lives",
    type: "website",
    images: ["/api/og?title=Where%20your%20AI%20work%20lives&org=curata"],
  },
  twitter: {
    card: "summary_large_image",
    title: "curata",
    description: "Where your AI work lives",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let theme = "dark";
  let mode = "dark";
  let texture = "none";
  let glow = "none";

  const ctx = await resolveOrg();
  if (ctx) {
    const org = await db.organization.findUnique({
      where: { id: ctx.orgId },
      select: { theme: true, mode: true, texture: true, glow: true },
    });
    if (org) {
      theme = org.theme;
      mode = org.mode;
      texture = org.texture;
      glow = org.glow;
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="shell-standard">
        <ThemeScript theme={theme} mode={mode} texture={texture} glow={glow} />
        {children}
      </body>
    </html>
  );
}
