import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TEKLead AI",
  description: "AI-powered lead generation & outreach",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
