import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';

// GET /api/config —— 读取系统配置 + 品控规则
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const configs = await sql`SELECT key, value, description FROM system_config ORDER BY key`;
    const rules = await sql`SELECT id, sub_type, name, conditions, severity, auto_level, enabled FROM qc_rules ORDER BY sub_type`;
    return successResponse({ configs: configs.rows, qc_rules: rules.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : '查询失败';
    return errorResponse(message, 500);
  }
}

// PUT /api/config —— 更新系统配置项（仅品控主管）
export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);
  if (!user.roles.includes('qc_supervisor')) return errorResponse('仅品控主管可修改配置', 403);

  try {
    const body = await request.json();
    const { key, value } = body as { key: string; value: unknown };
    if (!key) return errorResponse('key 必填', 400);

    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    await sql`
      UPDATE system_config SET value = ${valueStr}::jsonb, updated_at = NOW()
       WHERE key = ${key}
    `;
    return successResponse({ key, value }, '配置已更新');
  } catch (err) {
    const message = err instanceof Error ? err.message : '更新失败';
    return errorResponse(message, 500);
  }
}
