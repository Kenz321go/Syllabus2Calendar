import './globals.css';
import { Inter, Space_Grotesk } from 'next/font/google';
const inter = Inter({ subsets: ['latin'] });
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });
export const metadata = { title: 'Syllabus2Cal', description: 'Turn your syllabi into one calendar' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className={`${inter.className} ${grotesk.variable}`}>{children}</body></html>);
}
