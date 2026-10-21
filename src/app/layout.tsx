import type { Metadata, Viewport } from "next";
import "./globals.css";

// Icône inline (data:) : aucune ressource externe ni requête /favicon.ico en 404 (CSP stricte).
const ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="#7fd4ff" stroke-width="2"/><ellipse cx="16" cy="16" rx="15" ry="5" fill="none" stroke="#7fd4ff" stroke-width="1.2" opacity=".6"/></svg>')}`;

export const metadata: Metadata = {
  title: "ORBITAL — Contrôleur planétaire en temps réel",
  description: "Globe 3D : conflits, catastrophes, santé, ONU, espace, nucléaire, économie et dossiers OVNI, à partir de sources réelles et datées.",
  icons: { icon: ICON },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content", themeColor: "#010409" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" translate="no" className="dark bg-[#010409]">
      <body className="antialiased min-h-screen bg-[#010409] text-slate-100 overflow-hidden">
        {children}
      </body>
    </html>
  );
}
