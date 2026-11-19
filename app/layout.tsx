import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SwingLab · Golf Swing Analyzer",
  description: "Frame-by-frame golf swing analysis for Down-the-Line and Face-On video, right in your browser.",
};

export const viewport: Viewport = {
  themeColor: "#020617",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 antialiased">{children}</body>
    </html>
  );
}
