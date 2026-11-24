import type { Metadata } from "next";
import "./globals.css";
import { VT323 } from 'next/font/google';
import GlobalFooter from '@/components/layout/GlobalFooter';

const vt323 = VT323({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-vt323'
});

export const metadata: Metadata = {
  title: "SLAB",
  description: "Voice transcription and PII redaction system",
  icons: {
    icon: '/favicon-32x32.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={vt323.variable}>
      <body className="antialiased">
        {children}
        <GlobalFooter />
      </body>
    </html>
  );
}
