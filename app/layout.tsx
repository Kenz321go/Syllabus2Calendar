import './globals.css';
import { Inter } from 'next/font/google';
// One typeface throughout (headings use the same Inter via --font-display) for a calm, uniform look.
const inter = Inter({ subsets: ['latin'], variable: '--font-display' });
export const metadata = { title: 'Syllabus2Cal', description: 'Turn your syllabi into one calendar' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className={`${inter.className} ${inter.variable}`}>{children}</body></html>);
}
