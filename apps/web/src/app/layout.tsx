import './globals.css';
import { Providers } from './providers';
export const metadata = { title: 'Talqyla · Тренер школьных дебатов', description: 'Структурированные дебатные раунды для школьников 7–11 классов.' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ru"><body><Providers>{children}</Providers></body></html>; }
