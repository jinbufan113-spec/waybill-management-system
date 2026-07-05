import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/response';
import { runTimeoutWorker } from '@/lib/timeout-worker';
import { getCurrentUser } from '@/lib/auth';

// POST /api/cron/timeout  —— 触发超时自动流转 worker。
// Cron 密钥保护（CRON_SECRET 或沿用 EXTERNAL_API_KEY）。也允许登录的管理员手动触发。
export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('key');
    const expected = process.env.EXTERNAL_API_KEY || '';
    const user = await getCurrentUser();
    const isCron = expected && cronSecret === expected;
    const isHuman = user && (user.roles.includes('approver_l2') || user.roles.includes('qc_supervisor'));
    if (!isCron && !isHuman) {
      return errorResponse('无权触发（需 Cron 密钥或二级审批/品控主管登录）', 403);
    }
    const stats = await runTimeoutWorker();
    return successResponse(stats, '超时流转执行完成');
  } catch (err) {
    const message = err instanceof Error ? err.message : '执行失败';
    return errorResponse(message, 500);
  }
}
