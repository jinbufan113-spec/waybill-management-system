import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { setSessionCookie } from '@/lib/auth';
import type { RoleCode } from '@/types';

// POST /api/auth/login
export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) return errorResponse('账号和密码必填', 400);

    const res = await sql`
      SELECT u.id, u.name, u.username, u.password_hash, u.warehouse_id, u.disabled,
             COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.username = ${username}
       GROUP BY u.id
    `;
    if (res.rows.length === 0) return errorResponse('账号不存在', 401);
    const row = res.rows[0] as {
      id: number; name: string; username: string; password_hash: string;
      warehouse_id: string | null; disabled: boolean; roles: string[];
    };
    if (row.disabled) return errorResponse('账号已禁用', 403);
    if (row.password_hash !== password) return errorResponse('密码错误', 401);

    await setSessionCookie({
      uid: row.id,
      name: row.name,
      username: row.username,
      roles: row.roles as RoleCode[],
      warehouse_id: row.warehouse_id,
    });

    return successResponse(
      { id: row.id, name: row.name, username: row.username, roles: row.roles },
      '登录成功'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '登录失败';
    return errorResponse(message, 500);
  }
}
