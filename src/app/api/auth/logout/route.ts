import { successResponse } from '@/lib/response';
import { clearSessionCookie } from '@/lib/auth';

export async function POST() {
  await clearSessionCookie();
  return successResponse(null, '已退出');
}
