import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';

// POST /api/admin/dedup-qc-rules —— 清理 qc_rules 重复行（按 sub_type 保留最新一条）
// 一次性运维接口，仅品控主管可调用。
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);
  if (!user.roles.includes('qc_supervisor')) {
    return errorResponse('仅品控主管可执行', 403);
  }

  try {
    // 1) 先看当前有多少条、多少 sub_type
    const before = await sql`
      SELECT sub_type, COUNT(*)::int AS cnt FROM qc_rules GROUP BY sub_type ORDER BY sub_type
    `;

    // 2) 删除每个 sub_type 的重复行，保留 created_at 最新的一条
    const deleted = await sql`
      DELETE FROM qc_rules a
       USING qc_rules b
       WHERE a.sub_type = b.sub_type
         AND a.created_at < b.created_at
       RETURNING a.id
    `;

    // 3) 加唯一约束，防止今后重复插入（IF NOT EXISTS 容错）
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_qc_rules_sub_type') THEN
          ALTER TABLE qc_rules ADD CONSTRAINT uq_qc_rules_sub_type UNIQUE (sub_type);
        END IF;
      END $$
    `;

    const after = await sql`
      SELECT sub_type, name, severity, auto_level, enabled FROM qc_rules ORDER BY sub_type
    `;

    return successResponse({
      before: before.rows,
      deleted_count: (deleted.rows as unknown[]).length,
      after: after.rows,
    }, `已清理 ${(deleted.rows as unknown[]).length} 条重复品控规则`);
  } catch (err) {
    const message = err instanceof Error ? err.message : '清理失败';
    return errorResponse(message, 500);
  }
}
