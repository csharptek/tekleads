import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/layout/Sidebar';
export const metadata: Metadata = { title: 'TEKLead AI', description: 'AI-powered lead generation' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Sidebar />
        <main style={{ marginLeft: '224px', minHeight: '100vh', padding: '32px' }}>{children}</main>
      </body>
    </html>
  );
}
