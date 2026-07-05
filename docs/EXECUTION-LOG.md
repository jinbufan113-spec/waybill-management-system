# V3 实现执行记录

> 按要求 5、6：分步执行，记录每步结果。本文件随实施进度更新。

---

## 环境前置

- **Node 版本问题**：本地默认 Node 16.17.1，Next.js 16 要求 ≥20.9.0，构建报错。已切换到 nvm-windows 提供的 **Node 24.14.0**，构建通过。
- **数据库隔离**：V3 使用独立 Neon 实例 `autumn-waterfall-84758359`，与 V2 的 `little-math-93146911` 物理隔离，不直连 V2 库。

---

## 步骤 1：V2 二开 — 新增只读外部接口 ✅

**改动**（`smart-import-v2/`）：
- 新增 `src/lib/external-auth.ts`（X-API-Key 中间件）
- 新增 `src/app/api/external/waybills/route.ts`（列表，已按 external_code 聚合多 SKU）
- 新增 `src/app/api/external/waybills/[code]/route.ts`（详情+存在性）
- 新增 `src/app/api/external/waybills/[code]/skus/[sku]/route.ts`（SKU 归属校验）
- 新增 `src/app/api/external/waybills/[code]/exception-mark/route.ts`（异常标记回写，可选）
- 新增 `src/app/api/external/seed-demo-waybills/route.ts`（灌演示运单）
- `.env.local` 新增 `EXTERNAL_API_KEY`
- **不动**任何现有 V2 路由（考点 5 老系统二开意识）

**验证结果**（V2 dev:3000）：
| 场景 | 结果 |
|---|---|
| 运单存在 WB20260001 | 200 + 详情 |
| 运单不存在 WB99999999 | 404 |
| 无 API Key | 401 |
| SKU 归属（属于） | 200 `belongs:true` |
| SKU 归属（不属于） | 200 `belongs:false` |
| 异常标记回写 | 200 |
| V2 `next build` | ✅ 通过（4 个新路由注册） |

**遇到的问题**：Turbopack 对新增的深层嵌套路由 `[code]/skus/[sku]/route.ts` 首次编译未识别（返回 HTML 404 页）。`touch` 触发重编译后正常。这是 dev 热更新的偶发问题，不影响生产构建（build 已确认路由全部注册）。

---

## 步骤 2：V3 项目脚手架 ✅

- `package.json`（Next 16.2.6 / React 19.2.4 / @vercel/postgres，与 V2 同版本，视觉零割裂）
- `tsconfig.json`、`next.config.ts`、`postcss.config.mjs`、`vercel.json`、`.gitignore`、`next-env.d.ts`
- `.env.local`（V3 Neon URL + V2_BASE_URL + EXTERNAL_API_KEY + SESSION_SECRET + LLM_*）
- 从 V2 复用：`globals.css`（JingTian 设计 tokens）、`components/ui/*`（Button/Card/Input/Modal/Pagination/Select/Toast）、`lib/response.ts`、`lib/llm.ts`
- `npm install`：380 packages 安装成功
- `tsc --noEmit`：通过

---

## 步骤 3：V3 数据库初始化 ✅

`src/lib/init-db.ts` 建表 10 张 + 索引 + 种子：
- `roles` / `users` / `user_roles`（4 角色 4 用户）
- `waybill_snapshots`（V2 运单只读缓存）
- `api_sync_logs`（跨系统调用日志，Request-ID 全链路）
- `exception_tickets`（异常工单，含乐观锁 version、due_at、ai_suggestion）
- `approval_records`（审批记录，含 idempotency_key 唯一约束）
- `compensation_records`（赔付记录，含 payment_direction）
- `inventory` / `inventory_changes`（库存 + 变更，approval_id 反查链）
- `scan_records`（扫描记录，batch_lock_state 与工单状态分离，ticket_id 关联 1:N）
- `qc_rules`（品控规则，conditions JSONB 可配置）
- `system_config`（系统阈值，全部可配置）

**验证**：`POST /api/init-db?seed=1` → 200 成功；登录、查询均正常。

---

## 步骤 4：鉴权与布局 ✅

- `lib/auth.ts`（HMAC 签名 session cookie，服务端 getCurrentUser + 角色校验）
- `lib/auth-client.ts`（客户端 UserProvider + useUser）
- `(auth)/login`（登录页 + 演示账号快捷选择）
- `(main)/layout.tsx`（Sidebar + ToastProvider + 未登录跳转 /login）
- `Sidebar.tsx`（角色驱动菜单：品控主管可见"后台配置"，审批人可见"待我审批"）

**验证**：reporter 登录 200，`/api/auth/me` 返回正确用户与角色。

---

## 步骤 5：V2 Client + 接口监控（模块5）✅

- `lib/v2-client.ts`：8s 超时 + 重试 1 次 + Request-Id + 降级 + 写 api_sync_logs；`validateWaybillForReport()` 组合实时校验+缓存降级
- `lib/trace.ts`：Request-Id 生成 + 错误分类（TIMEOUT/NETWORK_UNREACHABLE/NOT_FOUND/UNAUTHORIZED/UPSTREAM_5XX/OTHER）
- `POST /api/sync/waybills`：从 V2 增量同步到本地快照
- `GET /api/sync/monitor`：最近同步时间/24h 成功率/日志/错误分类
- `(main)/monitor` 页：监控看板 + 最近 50 条调用日志 + 数据来源标注说明

**验证**：同步 131 条运单；监控页显示 Request-ID、状态码、耗时、成功/失败、错误分类。

---

## 步骤 6：工单上报（模块1）✅

- `POST /api/tickets`：实时调 V2 校验运单 + 同类型去重 + 归属校验 + 异常标记回写（不阻塞）
- `GET /api/tickets`：列表（状态/类型/来源/运单号筛选 + 分页）
- `GET /api/tickets/[id]`：详情（审计日志 + 运单信息 + 数据来源标注）
- `POST /api/tickets/[id]/submit`：提交进一级审批

**验证**：
| 场景 | 结果 |
|---|---|
| 上报丢件（真实运单） | 200，data_source=REALTIME |
| 重复同类型上报 | 409 拒绝 |
| 不存在运单上报 | 400（V2 实时校验拦截，带 request_id） |

---

## 步骤 7：状态机与审批引擎（模块2 核心）✅

- `lib/state-machine.ts`：合法流转判定 + 分级自动判定（金额>阈值升二级）
- `lib/approval-engine.ts`：读 system_config 阈值，不硬编码
- `lib/timeout-worker.ts`：超时自动流转（L1→L2，L2→驳回）
- `POST /api/approvals`：审批动作（乐观锁+幂等+权限后端校验+自批禁止+同事务执行联动）
- `GET /api/approvals/pending`：待我审批列表（按权限范围匹配，超时优先排序）
- `(main)/approvals` 页 + `tickets/[id]/TicketActions`（角色驱动操作按钮）

**验证**：
| 场景 | 结果 |
|---|---|
| 自批（reporter 审自己工单） | 403 |
| L1 通过金额300<500 | 直接 EXECUTING（赔付+库存联动生效）|
| L1 通过金额800>500 | 自动升 L2_REVIEWING |
| L2 通过 | EXECUTING |
| 幂等（同 Idempotency-Key 重复） | 返回既有记录，不重复 |
| 并发（两人同时审批） | 一人 200、一人 409"请刷新"，仅 1 条审批记录 |

---

## 步骤 8：扫描品控（模块0/7 核心）✅

- `lib/qc-engine.ts`：读 qc_rules 配置判定，记录 hit_rule_id（可追溯）
- `POST /api/scan`：实时 V2 校验 SKU 归属 + 品控判定 + 批次锁定 + 自动建工单（source=SCAN 入 L2）+ 幂等（重复扫描追加记录）+ 库存锁定
- `POST /api/qc/quick-release`：品控主管误判快速放行（强制填 reason 留痕，同事务解锁批次+解锁库存+关工单）
- `(main)/scan` 页

**验证**：
| 场景 | 结果 |
|---|---|
| 数量差异>5% | QTY_MISMATCH，工单创建（L2），批次 LOCKED |
| 重复扫描同批次 | APPENDED（不新建工单）|
| 扫描无关 SKU | 400（V2 SKU 归属校验拦截）|
| 品控主管快速放行 | COMPLETED，批次 UNLOCKED，留痕记录 |
| 非主管快速放行 | 403 |

---

## 步骤 9：执行联动（模块3 核心）✅

- `lib/execution-engine.ts`：物流类自动联动（丢件/破损/拒收/超时/地址错误 各自映射）+ 品控类 4 动作（RELEASE/RETURN_SUPPLIER/REPURCHASE/DOWNGRADE）
- `POST /api/execution`：品控工单执行动作 + `GET` 查询赔付/库存/库存变更
- `(main)/execution` 页

**验证（赔付方向字段正确区分）**：
| 异常 | 赔付方向 | 对账方式 | 库存 |
|---|---|---|---|
| 物流-丢件 | CUSTOMER | 客户理赔-货损 | -1 |
| 物流-破损 | CUSTOMER | 客户理赔-破损 | -1 |
| 品控-退供应商 | SUPPLIER | 向供应商追偿-退货 | -1 |
- 反查链：compensation_records.approval_id + inventory_changes.approval_id 均 FK 到 approval_records，无断链。

---

## 步骤 10：工单列表与压测数据（模块4）✅

- `(main)/tickets` 页：筛选（状态/类型/来源/搜索）+ 分页 + 超时角标
- `POST /api/seed`：生成 220 条压测工单（覆盖各状态/类型/来源，按权重分布）
- `(main)/tickets/[id]` 详情页：审计日志 + 赔付/库存可追溯 + 运单数据来源标注

**验证**：生成 220 条（共 225），列表/筛选/分页正常，按状态筛选（如 EXECUTING 43 条）秒级响应。

---

## 步骤 11：AI 辅助（可选加分）✅

- `POST /api/ai/classify`：异常描述→类型/严重度建议（带依据）
- `POST /api/ai/approval-suggestion`：历史审批→建议意见（说明参考了哪几条记录）
- CreateModal 集成"AI 推荐异常类型"按钮
- 全部标注"AI 建议，需人工确认"；LLM 不可用时降级提示，不阻塞主流程

**验证**：无 LLM_API_KEY 时返回 `available:false` + 友好提示，主流程正常。

---

## 步骤 12：交付文档 ✅

- `docs/API-CONTRACT.md`（V3↔V2 接口契约：鉴权/超时/重试/降级/可观测性/老系统二开意识）
- `docs/ASSUMPTIONS.md`（9 项留白全覆盖 + 多租户假设 + 向 PM 提问清单）
- `docs/REFLECTION.md`（6 反思题）
- `docs/EXECUTION-LOG.md`（本文件）
- `README.md`（部署/账号/特性）

---

## 步骤 13：构建部署与自测（进行中）

- V2 `next build`：✅ 通过（4 个新路由注册）
- V3 `tsc --noEmit`：✅ 通过
- 端到端自测：✅ 全部场景通过（见步骤 6–10 验证表）
- Vercel 部署：待执行（见下节）
