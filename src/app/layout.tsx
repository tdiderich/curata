import type { Metadata } from "next";
import { AUTH_MODE, resolveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { ThemeScript } from "@/components/theme-script";
import { Toaster } from "@/components/toast";
import { CommandPalette } from "@/components/command-palette";
import "./kazam.css";
import "./globals.css";

const SITE_TITLE = process.env.SITE_TITLE ?? "curata";
const SITE_DESCRIPTION = process.env.SITE_DESCRIPTION ?? "Where your AI work lives";
const OG_TITLE = process.env.OG_TITLE ?? SITE_DESCRIPTION;

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  metadataBase: new URL("https://curata.ai"),
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    images: [`/api/og?title=${encodeURIComponent(OG_TITLE)}&org=curata`],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

async function ClerkWrapper({ children }: { children: React.ReactNode }) {
  const { ClerkProvider } = await import("@clerk/nextjs");
  const { dark } = await import("@clerk/themes");
  return (
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        // Clerk v7 variable names — colorText/colorInputBackground are v5/v6
        // and silently ignored, which left footer text unreadable on dark.
        variables: {
          colorBackground: "#121113",
          colorPrimary: "#899878",
          colorPrimaryForeground: "#121113",
          colorForeground: "#F7F7F2",
          colorNeutral: "#B0B3AD",
          colorInput: "rgba(247, 247, 242, 0.08)",
          colorInputForeground: "#F7F7F2",
          borderRadius: "8px",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let theme = "dark";
  let mode = "dark";
  let texture = "none";
  let glow = "none";

  try {
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
  } catch {
    // DB unavailable during static generation — use defaults
  }

  const body = (
    <>
      <ThemeScript theme={theme} mode={mode} texture={texture} glow={glow} />
      {children}
      <CommandPalette />
      <Toaster />
    </>
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="shell-standard">
        {AUTH_MODE === "clerk" ? <ClerkWrapper>{body}</ClerkWrapper> : body}
      </body>
    </html>
  );
}
