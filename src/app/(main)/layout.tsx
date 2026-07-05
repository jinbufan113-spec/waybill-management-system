import { redirect } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import { ToastProvider } from '@/components/ui/Toast';
import { getCurrentUser } from '@/lib/auth';
import { MainShell } from './MainShell';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <ToastProvider>
      <MainShell user={user}>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto bg-jt-bg">{children}</main>
        </div>
      </MainShell>
    </ToastProvider>
  );
}
