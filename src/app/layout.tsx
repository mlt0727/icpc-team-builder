import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ICPC Team Builder",
  description: "Choose your ICPC team. A shared, live team board.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
