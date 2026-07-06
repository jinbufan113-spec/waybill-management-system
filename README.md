# 运单全流程管理系统 V3

> 录单（V2）→ 扫描品控 → 物流异常上报 → 分级审批 → 执行联动 —— 运单全生命周期管理。
> V3 与 V2 是两个**独立部署、独立数据库**的系统，仅通过 HTTP API 通信。

## 项目结构

- `doc/` — 题目文档（考试要求）
- `docs/` — 交付文档
  - `API-CONTRACT.md` — V3↔V2 系统间接口契约
  - `ASSUMPTIONS.md` — 需求理解与假设说明（9 项留白）
  - `AI-USAGE.md` — 大模型调用说明
  - `REFLECTION.md` — 反思题（6 题）
  - `EXECUTION-LOG.md` — 分步执行记录
- `src/` — 源码（Next.js 16 App Router + TypeScript）

## 演示账号（密码均为 `demo123`）

| 用户名 | 角色 | 能力 |
|---|---|---|
| `reporter` | 上报人 | 上报异常、扫描品控 |
| `l1` | 一级审批人 | 一级审批 |
| `l2` | 二级审批人 | 一/二级审批 |
| `qc` | 品控主管 | 审批 + 误判快速放行 + 后台配置 |

## 本地开发

```bash
# Node 20+（推荐 24）
npm install
# 配置 .env.local（V3 Neon URL + V2_BASE_URL + EXTERNAL_API_KEY + LLM_*）
# 首次初始化数据库（建表 + 种子）：
curl -X POST "http://localhost:3000/api/init-db?seed=1"   # V2 端先灌运单数据
curl -X POST "http://localhost:3001/api/init-db?seed=1"   # V3 端建表+种子
# 同步 V2 运单到 V3 快照：
curl -X POST "http://localhost:3001/api/sync/waybills"
npm run dev   # V3 默认 3000，本地调试可改 3001
```

## 部署

独立 Vercel 项目（与 V2 分开）。配置环境变量：
- `POSTGRES_URL` — V3 独立 Neon（autumn-waterfall-84758359）
- `V2_BASE_URL` — V2 的在线地址
- `EXTERNAL_API_KEY` — 与 V2 一致的 API Key
- `SESSION_SECRET` — V3 session 签名密钥
- `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL` — 可选 AI 辅助

## 在线地址

- V3：_部署后回填_
- V2：_部署后回填_
- 源码：https://github.com/jinbufan113-spec/waybill-management-system.git

## 核心特性

- ✅ 两套分离的状态机（工单 + 扫描批次），通过 `ticket_id` 关联
- ✅ 分级审批引擎（阈值/超时/重提全可配置，不硬编码）
- ✅ 并发冲突（乐观锁 + 409）、幂等（Idempotency-Key）、自批禁止、超时自动流转
- ✅ 执行联动同事务保证一致性（赔付方向字段区分客户理赔/供应商追偿）
- ✅ 跨系统接口（Request-ID 全链路、超时重试降级、监控可观测）
- ✅ 扫描品控（实时 SKU 校验、批次锁定、误判快速放行留痕）
- ✅ AI 辅助（异常分类/审批建议，标注"需人工确认"，失败不阻塞）
