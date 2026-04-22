import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "TEKLead AI",
  description: "AI-powered lead generation & outreach",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Sidebar />
        <main style={{ marginLeft: 240, minHeight: '100vh', background: 'var(--bg)' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
