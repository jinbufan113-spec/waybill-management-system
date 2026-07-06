# 大模型调用说明（AI Usage）

> 本文档说明 V3 中大模型（LLM）的接入方式、Prompt 设计、介入环节，以及如何保证「AI 建议需人工确认」这条原则被严格遵守。
> 对应题目「大模型调用说明（如有使用）」可选加分项。

---

## 一、使用的模型

| 项 | 配置 |
|---|---|
| Provider | DeepSeek（OpenAI 兼容接口） |
| Model | `deepseek-chat` |
| 接入方式 | 复用 V2 的 `src/lib/llm.ts` 的 `callLLM()`，OpenAI 兼容 `/v1/chat/completions` |
| 温度 | `temperature = 0.1`（低温度保证输出稳定、可结构化解析） |
| 响应格式 | 强制 JSON 对象（`response_format: { type: 'json_object' }`） |
| 超时 | 30 秒（`AbortController`，超时自动中断） |
| 环境变量 | `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL`（未配 `LLM_API_KEY` 时自动降级，不报错） |

> 选 DeepSeek 的原因：V2 已接入同一模型，复用现成客户端与配额，零额外成本；OpenAI 兼容协议便于将来切换其他模型（如通义/智谱/Claude）。

---

## 二、AI 介入的环节（两处，均为辅助）

### 环节 1：异常描述 → 异常类型/严重度 推荐

**入口**：上报异常弹窗里的「✨ AI 推荐异常类型（需人工确认）」按钮
**接口**：`POST /api/ai/classify`
**触发时机**：用户填写完「情况描述」后**主动点击**（不自动触发，不打断输入）

**入参**：
```json
{ "description": "客户反馈包裹一直没收到" }
```

**Prompt 设计**（System Prompt 约束输出范围与格式）：
```
你是物流异常分类助手。根据用户描述判断异常类型与严重度。
可选类型（只返回其中之一）：
物流类：LOST(丢件), DAMAGED(破损), REFUSED(客户拒收), TIMEOUT_UNSIGNED(超时未签收), WRONG_ADDRESS(地址错误)
严重度：LOW, MEDIUM, HIGH
返回 JSON：{"exception_type": "...", "severity": "...", "reason": "判断依据"}
注意：这是建议，需人工确认。
```

**返回**（成功）：
```json
{
  "available": true,
  "suggestion": {
    "exception_type": "LOST",
    "severity": "HIGH",
    "reason": "用户描述'一直没收到'通常对应丢件场景"
  },
  "disclaimer": "AI 建议，需人工确认"
}
```

**前端行为**：把建议的类型**预填到下拉框**（用户可改），并弹 Toast「AI 建议：LOST / HIGH（需人工确认）」。**绝不自动提交**。

---

### 环节 2：历史审批记录 → 审批意见建议

**入口**：工单详情页（审批人视角，预留扩展点）
**接口**：`POST /api/ai/approval-suggestion`
**触发时机**：审批人**主动请求**建议时调用（不自动弹窗）

**入参**：
```json
{ "ticket_id": "uuid" }
```

**Prompt 设计**（强制说明依据，非黑箱结论）：
```
你是审批辅助助手。根据当前工单信息和历史同类审批记录，给出建议审批意见。
必须说明依据（参考了哪几条历史记录、其决策与理由）。
返回 JSON：{"recommend": "APPROVE" | "REJECT", "reason": "依据..."}
注意：这是建议，需人工确认。
```

**关键设计——拒绝黑箱**：User Prompt 里会**注入最近 5 条同类型历史审批记录**（含决策与意见），模型必须引用这些记录作为依据。返回的 `references` 字段也回传给前端展示，让审批人看到「AI 参考了哪几条历史」。

**返回**（成功）：
```json
{
  "available": true,
  "suggestion": { "recommend": "APPROVE", "reason": "近 5 条丢件工单中 4 条一审通过..." },
  "references": [
    { "ticket_no": "TK-xxx", "decision": "APPROVE" },
    ...
  ],
  "disclaimer": "AI 建议，需人工确认"
}
```

---

## 三、如何保证「AI 建议需人工确认」被严格遵守

这是题目的硬性原则，通过**五重保障**实现：

| 保障 | 实现位置 | 说明 |
|---|---|---|
| **① 不自动执行** | 前端按钮需用户主动点击 | AI 永远不自动改工单状态、不自动审批 |
| **② 仅预填不替换** | CreateModal / 详情页 | AI 结果只填入表单默认值，用户可任意修改 |
| **③ 明确标注** | 接口返回 `disclaimer: "AI 建议，需人工确认"` | 前端 Toast/卡片显式展示该文案 |
| **④ 说明依据** | 审批建议接口注入历史记录 + 返回 references | 不是黑箱结论，可追溯参考了哪些数据 |
| **⑤ 后端不依赖 AI 决策** | 状态机/审批/执行引擎完全独立于 AI | AI 只是辅助展示，业务流转的合法性由 `state-machine.ts` / `approval-engine.ts` 强制 |

---

## 四、AI 服务超时或调用失败时不阻塞主流程

这也是题目硬性要求。实现方式：

### 1. 未配置 `LLM_API_KEY`（如当前线上未配）
接口直接返回降级提示，**不调用 LLM、不报错**：
```json
{
  "available": false,
  "message": "AI 服务未配置（LLM_API_KEY 为空），请人工选择异常类型"
}
```
上报/审批流程**完全不受影响**，用户手工填表。

### 2. LLM 调用失败（超时 / 网络错误 / 响应非 JSON）
`callLLM()` 自带 30s 超时；外层 `try/catch` 捕获任何异常，返回：
```json
{
  "available": false,
  "message": "AI 调用失败（不阻塞上报）：timeout of 30000ms exceeded"
}
```
**绝不抛 500**，绝不阻断用户继续操作。

### 3. 验证过的"不阻塞"场景
演练实测：当前线上未配 `LLM_API_KEY`，全流程（上报→审批→执行→扫描→放行）**均正常完成**，AI 仅在用户主动点推荐按钮时返回降级提示。这本身就是"AI 不阻塞主流程"的现场证据。

---

## 五、Prompt 设计思路总结

1. **System Prompt 强约束输出**：限定可选枚举值（异常类型/严重度/决策），强制 JSON schema，降低解析失败率。
2. **低温度（0.1）**：分类/建议类任务要稳定一致，不要创造性。
3. **强制依据**：审批建议必须引用历史记录，避免黑箱（题目原文要求）。
4. **"建议需人工确认"写进 Prompt**：让模型自己也输出这句 disclaimer，双保险。
5. **历史记录注入而非全量**：只取最近 5 条同类型，控制 token 成本与噪声。
6. **容错解析**：兼容模型偶尔把 JSON 包在 ` ```json ` 代码块里的情况（`replace` 清洗后再 `JSON.parse`）。

---

## 六、相关代码位置

| 功能 | 文件 |
|---|---|
| LLM 客户端（超时/JSON 模式） | `src/lib/llm.ts`（复用 V2） |
| 异常分类接口 | `src/app/api/ai/classify/route.ts` |
| 审批建议接口 | `src/app/api/ai/approval-suggestion/route.ts` |
| 上报弹窗 AI 按钮集成 | `src/app/(main)/tickets/page.tsx`（CreateModal） |
| 环境变量 | `.env.local`（`LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL`） |

---

## 七、未来扩展（可选）

- 接入图片 OCR：扫描品控时拍照识别破损等级（题目提到"根据扫描描述文本和图片推荐品控异常子类型"），目前仅文本。
- 多模型 fallback：DeepSeek 失败时降级到本地规则引擎或另一供应商。
- 建议采纳率埋点：统计"AI 建议被采纳 vs 被修改"比例，用于优化 Prompt。
