import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "./globals.css";
export const metadata: Metadata = {
  title: "Noticioner AI · Clinical workspace",
  description:
    "Explainable clinical documentation research prototype. Synthetic demonstration data only.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
