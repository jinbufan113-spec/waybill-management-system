# V3 ↔ V2 系统间接口契约

> 对应考点 5（15 分）。V3 与 V2 是两个独立系统、各自独立数据库、独立部署，仅通过 HTTP API 通信。
> V3 不直连 V2 数据库；所有运单数据通过本契约定义的接口获取。

---

## 一、接口总览

V2 在原有路由之外**新增一组只读外部接口**（`/api/external/*`），不动 V2 现有调用方。V3 作为消费方调用。

| V2 接口 | 方法 | 用途 | V3 调用点 |
|---|---|---|---|
| `/api/external/waybills` | GET | 分页查询运单列表（含 SKU 明细聚合） | 快照初始化/增量同步 |
| `/api/external/waybills/:code` | GET | 校验运单存在 + 获取详情 | 发起异常上报时实时校验 |
| `/api/external/waybills/:code/skus/:sku` | GET | 校验 SKU 是否归属于指定运单 | 扫描录入时校验 |
| `/api/external/waybills/:code/exception-mark` | POST/GET | 异常标记回写/查询（可选加分） | 工单创建后回写 V2 |
| `/api/external/seed-demo-waybills` | POST | 灌入演示运单数据 | 仅开发/演示用 |

---

## 二、鉴权机制

**方式**：API Key（`X-API-Key` 请求头）。

- V2 端：`EXTERNAL_API_KEY` 环境变量配置期望值；`lib/external-auth.ts` 的 `requireExternalKey()` 中间件统一校验。
- V3 端：`EXTERNAL_API_KEY` 环境变量（与 V2 同值），`lib/v2-client.ts` 在每次请求头携带 `X-API-Key`。
- 校验失败返回 `401`；未配置 key 返回 `503`。
- 同时携带 `X-Request-Id`（V3 生成，前缀 `v3_`）用于全链路追踪，V2 可记录。

> 不要求企业级 OAuth，满足题目"API Key / Token 均可"的要求。

---

## 三、接口详情

### 1. GET `/api/external/waybills` — 运单列表

**Query**：
- `cursor`（可选）：上一页最后一条 `id`，增量分页（游标式）。
- `limit`（可选，默认 100，最大 500）。
- `updated_since`（可选）：ISO 时间，只返回该时间后更新的（增量同步用）。

**响应**：
```json
{
  "success": true,
  "data": {
    "list": [
      {
        "waybill_code": "WB20260001",
        "store_name": "杭州西湖店",
        "receiver_name": "张伟",
        "receiver_phone": "13100000000",
        "receiver_address": "杭州西湖区示范路 1 号",
        "batch_id": "seed-xxx",
        "created_at": "2026-07-05T...",
        "estimated_amount": 30,
        "sku_items": [
          { "sku_code": "SKU-1001", "sku_name": "无线蓝牙耳机", "sku_quantity": 1, "sku_spec": "白色/Pro" }
        ]
      }
    ],
    "count": 60,
    "next_cursor": "3397",
    "has_more": false
  }
}
```

> V2 的 `waybill_order` 是行级表（一运单多 SKU 行），本接口已按 `external_code` 聚合为"一张运单含多 SKU 明细"结构。

### 2. GET `/api/external/waybills/:code` — 运单详情与存在性

**响应**（存在）：`200`，`data.exists = true` + 完整详情。
**响应**（不存在）：`404`，`{ success: false, message: "运单 XX 不存在" }`。

V3 据此区分"运单真的不存在"（阻止上报）与"网络错误"（降级缓存）。

### 3. GET `/api/external/waybills/:code/skus/:sku` — SKU 归属校验

**响应**（属于）：`data.belongs = true` + SKU 明细。
**响应**（运单存在但 SKU 不属于）：`data.belongs = false, reason: "SKU_NOT_BELONG_TO_WAYBILL"`。
**响应**（运单不存在）：`404`。

### 4. POST `/api/external/waybills/:code/exception-mark` — 异常标记回写（可选）

**Body**：`{ "source_ticket_id": "V3工单ID", "action": "mark" | "clear", "note": "..." }`

幂等：`(waybill_code, source_ticket_id)` 联合主键，重复写只更新时间。

---

## 四、超时、重试与幂等

V3 `lib/v2-client.ts` 封装：

| 策略 | 设定 |
|---|---|
| 单次超时 | 8 秒（`AbortController`） |
| 重试次数 | 失败重试 1 次（网络错误/5xx 重试，4xx 业务错误不重试） |
| 幂等保证 | GET 天然幂等；每次请求带 `X-Request-Id`，V2 可据此去重；POST（回写）由 V2 端联合主键保证幂等 |
| 重试间隔 | 立即重试（简化，未做指数退避） |

---

## 五、降级方案（V2 不可用时）

V3 不允许因 V2 故障而白屏/崩溃。`validateWaybillForReport()` 实现：

1. 先实时调 V2 校验运单。
2. **404**（运单真不存在）→ 阻止上报，明确提示。
3. **其他失败**（超时/网络/5xx）→ 降级到本地快照表 `waybill_snapshots`：
   - 若有缓存 → 允许上报，但前端**明确标注**"使用本地缓存，同步于 XX 时间，数据可能非最新"。
   - 若无缓存 → 提示"V2 不可用且无本地缓存"，但不崩溃。
4. 工单详情页同样实时尝试 V2，失败回退缓存并标注来源。

---

## 六、数据新鲜度与一致性策略

- **实时校验**：发起异常上报、扫描录入 SKU 校验——这两个关键动作**必须实时调 V2**，不依赖本地快照。
- **快照同步**：本地快照用于列表/详情展示，每 10 分钟增量同步一次（`SYNC_INTERVAL_MINUTES`）。
- **边界处理（V2 数据在 V3 处理期间变更）**：每次查看工单详情时优先实时拉取 V2，失败回退缓存；变更感知靠"实时优先 + 缓存兜底 + Request-ID 日志可追溯"，不强行做双向对账。

---

## 七、可观测性

每次跨系统调用都写入 V3 的 `api_sync_logs` 表：

| 字段 | 说明 |
|---|---|
| `request_id` | 全链路追踪 ID（`v3_` 前缀 + UUID） |
| `endpoint` | 接口名（如 `GET /api/external/waybills/WB20260001`） |
| `method` | HTTP 方法 |
| `params_digest` | 入参摘要（前 200 字符，避免大字段） |
| `status_code` | 响应状态码（区分 404 运单不存在 vs 网络超时） |
| `duration_ms` | 耗时 |
| `success` | 是否成功 |
| `error_class` | 错误分类标签（`TIMEOUT` / `NETWORK_UNREACHABLE` / `NOT_FOUND` / `UNAUTHORIZED` / `UPSTREAM_5XX` / `OTHER`） |

监控页（`/monitor`）展示最近同步时间、24h 成功率、最近 50 条日志、错误分类 breakdown。能通过 Request-ID 还原完整调用链。

---

## 八、老系统二开意识（V2 新增接口如何不破坏现有调用方）

> 考点 5 子项。V2 原本只有 `/api/parse`、`/api/orders`、`/api/rules` 等内部接口，没有对外查询接口。新增 `/api/external/*` 时的工程判断：

1. **路由隔离**：新增 `/api/external/` 前缀下的独立路由组，与 V2 现有路由完全分离，不影响现有调用方。
2. **版本策略**：如未来需要演进，可在 `/api/external/v1/` 下版本化，老版本保留一个迁移期。
3. **字段向后兼容**：V2 接口只增不减字段，不删不改类型；V3 侧 `v2-client.ts` 对可选字段做容错（`wb.estimated_amount ?? 0`）。
4. **灰度上线**：先只读接口（GET），稳定后再加回写（POST exception-mark），降低风险。
5. **V2 字段类型变更应对**：如 V2 运单金额从 `int` 改为 `decimal`，V3 侧用 `Number()` 统一解析（JS 不区分），并在 `api_sync_logs` 监控异常；schema 变更通过接口文档同步。
6. **鉴权独立**：`EXTERNAL_API_KEY` 是独立密钥，与 V2 现有 session 鉴权无关，互不影响。
