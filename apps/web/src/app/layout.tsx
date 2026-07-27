import './globals.css';
import { Providers } from './providers';

export const metadata = { title: 'Talqyla | Debate practice', description: 'Practice sharper arguments with an AI sparring partner.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body><Providers>{children}</Providers></body></html>;
}
