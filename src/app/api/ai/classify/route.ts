import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { callLLM } from '@/lib/llm';

// POST /api/ai/classify —— 根据异常描述文本，AI 推荐异常类型与严重度。
// 规则：明确标注"AI 建议，需人工确认"；失败不阻塞主流程（前端可独立上报）。
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const { description } = (await request.json()) as { description: string };
    if (!description || !description.trim()) {
      return errorResponse('请输入异常描述', 400);
    }

    // LLM 不可用（无 key）时直接返回降级提示，不抛错
    if (!process.env.LLM_API_KEY) {
      return successResponse({
        available: false,
        message: 'AI 服务未配置（LLM_API_KEY 为空），请人工选择异常类型',
      });
    }

    const systemPrompt = `你是物流异常分类助手。根据用户描述判断异常类型与严重度。
可选类型（只返回其中之一）：
物流类：LOST(丢件), DAMAGED(破损), REFUSED(客户拒收), TIMEOUT_UNSIGNED(超时未签收), WRONG_ADDRESS(地址错误)
严重度：LOW, MEDIUM, HIGH
返回 JSON：{"exception_type": "...", "severity": "...", "reason": "判断依据"}
注意：这是建议，需人工确认。`;

    let parsed: unknown = null;
    try {
      const raw = await callLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: description },
      ]);
      // 兼容 markdown code block
      const cleaned = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return successResponse({
        available: false,
        message: `AI 调用失败（不阻塞上报）：${e instanceof Error ? e.message : 'error'}`,
      });
    }

    return successResponse({
      available: true,
      suggestion: parsed,
      disclaimer: 'AI 建议，需人工确认',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 失败';
    return errorResponse(message, 500);
  }
}
