'use client';

import { UserProvider } from '@/lib/auth-client';
import type { User } from '@/types';

// 客户端外壳：把服务端拿到的 user 注入 UserProvider，供 Sidebar 等组件消费
export function MainShell({ user, children }: { user: User; children: React.ReactNode }) {
  const refresh = async () => {
    // 简化：刷新页面即可重新拉取
    if (typeof window !== 'undefined') window.location.reload();
  };
  return <UserProvider value={{ user, refresh }}>{children}</UserProvider>;
}
