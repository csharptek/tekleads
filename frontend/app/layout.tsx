import "./globals.css";

export const metadata = {
  title: "TEKLead AI",
  description: "Lead generation and outreach automation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
