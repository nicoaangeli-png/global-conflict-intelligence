import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORBITAL // Global Conflict Intelligence System",
  description: "Next-generation 3D holographic geospatial conflict monitoring interface.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark bg-[#010409]">
      <body className="antialiased min-h-screen bg-[#010409] text-slate-100 overflow-hidden">
        {children}
      </body>
    </html>
  );
}
