import { NextRequest } from 'next/server';
import { initDatabase, seedDatabase } from '@/lib/init-db';
import { successResponse, errorResponse } from '@/lib/response';

// POST /api/init-db  —— 建表 + 灌种子。幂等可重入。
// query: ?seed=1 才灌种子（首次需要）
export async function POST(request: NextRequest) {
  try {
    await initDatabase();
    const seed = request.nextUrl.searchParams.get('seed') === '1';
    if (seed) await seedDatabase();
    return successResponse({ initialized: true, seeded: seed }, '数据库初始化完成');
  } catch (err) {
    const message = err instanceof Error ? err.message : '初始化失败';
    return errorResponse(message, 500);
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
