import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Portal First Blades',
  description: 'Portal interno de operaciones de campo · First Blades',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
