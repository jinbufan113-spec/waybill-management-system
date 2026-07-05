import { cookies } from 'next/headers';
import { createHmac } from 'crypto';
import { sql } from '@/lib/db';
import type { RoleCode, User } from '@/types';

const SESSION_SECRET = process.env.SESSION_SECRET || 'v3_default_session_secret';
const COOKIE_NAME = 'v3_session';
const ALGO = 'sha256';

// token 格式：base64(payload).base64(signature)
interface SessionPayload {
  uid: number;
  name: string;
  username: string;
  roles: RoleCode[];
  warehouse_id?: string | null;
}

function sign(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac(ALGO, SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token: string): SessionPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac(ALGO, SESSION_SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload) {
  const store = await cookies();
  store.set(COOKIE_NAME, sign(payload), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 小时
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// 在服务端读取当前登录用户（从 cookie 解析，再查库确认未禁用）
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verify(token);
  if (!payload) return null;

  try {
    const res = await sql.query(
      `SELECT u.id, u.name, u.username, u.warehouse_id, u.disabled,
              COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.id = $1
        GROUP BY u.id`,
      [payload.uid]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0] as {
      id: number;
      name: string;
      username: string;
      warehouse_id: string | null;
      disabled: boolean;
      roles: string[];
    };
    if (row.disabled) return null;
    return {
      id: row.id,
      name: row.name,
      username: row.username,
      warehouse_id: row.warehouse_id,
      roles: row.roles as RoleCode[],
      disabled: row.disabled,
    };
  } catch {
    // 库未初始化时回退到 cookie 内信息（仅用于初始化流程）
    return {
      id: payload.uid,
      name: payload.name,
      username: payload.username,
      warehouse_id: payload.warehouse_id ?? null,
      roles: payload.roles,
    };
  }
}

export function hasRole(user: User | null, role: RoleCode): boolean {
  return !!user && user.roles.includes(role);
}

export function requireRole(user: User | null, role: RoleCode): Error | null {
  if (!user) return new Error('未登录');
  if (!user.roles.includes(role)) return new Error(`无权限：需要 ${role} 角色`);
  return null;
}
