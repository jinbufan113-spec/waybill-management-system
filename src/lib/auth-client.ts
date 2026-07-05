'use client';

import { createContext, useContext } from 'react';
import type { User } from '@/types';

interface UserCtx {
  user: User | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<UserCtx>({ user: null, refresh: async () => {} });

export const UserProvider = Ctx.Provider;
export const useUser = () => useContext(Ctx);
