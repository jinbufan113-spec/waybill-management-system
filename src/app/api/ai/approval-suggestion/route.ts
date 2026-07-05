import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { callLLM } from '@/lib/llm';

// POST /api/ai/approval-suggestion —— 根据历史审批记录给出"建议审批意见"。
// 要求：说明依据（参考了哪几条历史记录）；标注"AI 建议，需人工确认"；失败不阻塞。
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const { ticket_id } = (await request.json()) as { ticket_id: string };
    if (!ticket_id) return errorResponse('ticket_id 必填', 400);

    if (!process.env.LLM_API_KEY) {
      return successResponse({ available: false, message: 'AI 服务未配置，请人工审批' });
    }

    // 取当前工单
    const tRes = await sql`
      SELECT ticket_no, waybill_code, exception_type, amount, description, source
        FROM exception_tickets WHERE id = ${ticket_id}
    `;
    if (tRes.rows.length === 0) return errorResponse('工单不存在', 404);
    const t = tRes.rows[0];

    // 取同类型历史审批记录（已决）作为参考依据
    const hist = await sql`
      SELECT a.decision, a.opinion, a.level, t.exception_type, t.amount, t.ticket_no
        FROM approval_records a
        JOIN exception_tickets t ON t.id = a.ticket_id
       WHERE t.exception_type = ${t.exception_type}
         AND a.decision IS NOT NULL
       ORDER BY a.created_at DESC LIMIT 5
    `;

    if (hist.rows.length === 0) {
      return successResponse({
        available: true,
        suggestion: { recommend: 'NEED_MORE_INFO', reason: '无同类型历史记录可参考，建议人工判断' },
        disclaimer: 'AI 建议，需人工确认',
      });
    }

    const systemPrompt = `你是审批辅助助手。根据当前工单信息和历史同类审批记录，给出建议审批意见。
必须说明依据（参考了哪几条历史记录、其决策与理由）。
返回 JSON：{"recommend": "APPROVE" | "REJECT", "reason": "依据..."}
注意：这是建议，需人工确认。`;

    const userMsg = `当前工单：${JSON.stringify(t)}
历史同类审批记录（最近 ${hist.rows.length} 条）：${JSON.stringify(hist.rows)}`;

    let parsed: unknown = null;
    try {
      const raw = await callLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ]);
      const cleaned = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return successResponse({
        available: false,
        message: `AI 调用失败（不阻塞审批）：${e instanceof Error ? e.message : 'error'}`,
      });
    }

    return successResponse({
      available: true,
      suggestion: parsed,
      references: hist.rows.map((r) => ({ ticket_no: (r as { ticket_no: string }).ticket_no, decision: (r as { decision: string }).decision })),
      disclaimer: 'AI 建议，需人工确认',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 失败';
    return errorResponse(message, 500);
  }
}
