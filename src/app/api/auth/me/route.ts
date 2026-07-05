import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);
  return successResponse(user);
}
