import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import "./globals.css";

const body = Barlow({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600"] });
const display = Barlow_Condensed({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "Daily Teardown",
  description:
    "One object a day falls to pieces. Put it back together faster than everyone else, or turn any photo into a puzzle for a friend. Built on Aholo Lux3D.",
};

export const viewport: Viewport = { themeColor: "#1d4a44", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
