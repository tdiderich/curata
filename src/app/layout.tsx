import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="shell-standard">{children}</body>
    </html>
  );
}
