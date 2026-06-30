import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AiVoX — Настройка бизнеса',
  description: 'Помощник по настройке бизнес-профиля',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="font-sans antialiased">
        <ClerkProvider dynamic>{children}</ClerkProvider>
      </body>
    </html>
  );
}
