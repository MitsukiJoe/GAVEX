---
name: gavex
description: "GAVEX: Guarded Audit & Verifier-gated EXecution. Use for risky multi-module refactors, cross-file features, migrations, release hardening and hard bugs requiring adversarial cross-audit. The main agent plans Step 1..N, dispatches disjoint Write-Scope workers per step, then an independent Verifier applies G1-G4 and requires STEP_K_VERIFIED_PASS before the next step. Activation phrases: gavex, gavexA, gavexB, gavexAB, 阶梯门禁, 并行施工, 独立验工, 对抗会审."
metadata:
  version: "2.0.0"
  default_mode: gavexB
  platforms: [openclaw, claude-code, opencode, pi, dsh, hermes]
  modes: [gavexA, gavexB, gavexAB]
  verdict_tokens: [STEP_K_VERIFIED_PASS, STEP_K_REJECTED, UNCONDITIONAL_CONSENSUS, GAVEX_FINAL_ACCEPTED, GAVEX_ESCALATED]
---

# GAVEX — 阶梯门禁并行集群与独立验工协议

> **G**uarded **A**udit & **V**erifier-gated **EX**ecution
> **让子代理在互斥边界内并行施工，让独立守门员握着法槌一票否决。**
> *Parallel workers build inside guarded scopes. An independent verifier holds the gavel.*
> 一套与业务形态无关的多智能体执行协议：**先拆阶梯 → 同阶非重叠并行 → 专职独立验工 → 不过关就打回 → 过关才解锁下一阶**。

本文件是一份**可直接安装**的通用 Skill。它只依赖每个 Agent 运行时都具备的三种原语：

| 原语 | 含义 | 各平台对应 |
| --- | --- | --- |
| `spawn(brief)` | 派出一个拥有独立上下文的子代理 | OpenClaw `sessions_spawn` · Claude Code `Task` · OpenCode subagent · Pi / DSH / Hermes 的 sub-agent / delegate 能力 |
| `wait(ids)` | 事件驱动地等待子代理交卷（不忙轮询） | OpenClaw `agents_wait` / `sessions_yield` · Claude Code 并行 `Task` 返回 · 其余平台的 join / await |
| `run(cmd)` | 在真实环境执行命令并读取退出码 | shell / exec / bash 工具 |

如果平台没有 `spawn`，GAVEX 退化为**单 Agent 串行模式**：同样按 Step 推进、同样必须独立复核（见 §9）。

---

## 1. 何时启用 / 何时不要启用

**启用**（满足任一条）：

- 改动跨越 ≥ 3 个模块或 ≥ 8 个文件，且模块之间存在先后依赖；
- 需要多个子代理同时开工，存在并发写同一文件的风险；
- 交付结果必须经得起"真实入口"复现，不能接受自评式的"已完成 100%"；
- 疑难 Bug / 架构抉择需要多个异构模型交叉盲审（gavexA）。

**不要启用**：单文件小修、纯问答、无可验证产物的头脑风暴。此时 GAVEX 的门禁成本高于收益。

---

## 2. 呼出指令（Invocation）

触发后先选定模式，再按对应协议执行；`gavex` 默认等同于 `gavexB`。所有派单、台账、看板与交卷统一使用下列正式指令。兼容触发词仅负责入口映射，不产生另一套令牌或安装路径。

| 指令 | 模式 | 适用场景 | 产出 |
| --- | --- | --- | --- |
| `gavex <目标>` | **默认 Mode B**（同 `gavexB`） | 已明确目标的受控施工 | 阶梯计划 → 独立验工 → `GAVEX_FINAL_ACCEPTED` |
| `gavexA <问题>` | **Mode A · 3+1 异构对抗会审** | 疑难 Bug 定位、架构方案抉择、事故复盘 | 带实证探针的共识结论 `UNCONDITIONAL_CONSENSUS` |
| `gavexB <目标>` | **Mode B · 阶梯门禁并行施工** | 多模块重构、新功能落地、迁移与发布加固 | 逐阶 `STEP_K_VERIFIED_PASS` + 最终 `GAVEX_FINAL_ACCEPTED` |
| `gavexAB <目标>` | **全套闭环** | 高风险大工程：先会审定方案，再阶梯施工 | 会审共识 → 阶梯计划 → 逐阶验工 → 总验收 |

可选参数（追加在指令末尾，均有默认值）：

```text
--steps=auto|N          阶梯数，默认 auto（由 Main-Agent 依赖分析决定，建议 3–8）
--max-workers=3         每个 Step 内并行 Worker 上限，默认 3；可设为 M，A/B/C 只是示例
--max-rework=3          每个 Step 打回重修上限，超限则升级给用户
--patrol=5m             Watchdog 低频巡检间隔，默认 5 分钟
--ledger=.gavex/ledger.md  施工台账路径（默认）
--dry                   只输出阶梯计划与 Write-Scope 矩阵，不派工
```

---

## 3. 角色与硬边界（Roles）

| 角色 | 由谁担任 | 能做什么 | 严禁做什么 |
| --- | --- | --- | --- |
| **Main-Agent**（总调度） | 当前会话主代理 | 拆解阶梯、分配 Write-Scope、派工、唤醒 Verifier、记台账、总验收 | 亲自下场写业务代码；把 Worker 的自评直接转述给用户 |
| **Worker K-X**（施工员） | 子代理，X 为唯一编号（A/B/C 仅示例，可扩展到 M 名） | 仅在自己的 Write-Scope 内读写；增量落盘；自测后交卷 | 写 Write-Scope 外的任何文件；宣称"已验证通过" |
| **Verifier K**（专职独立审验员） | 全新上下文的子代理，**不得**是本 Step 的任何 Worker | 全仓只读；真实入口跑探针；签发 PASS / REJECTED | 修改任何文件；降低需求标准；"差不多就过" |
| **Reviewer α/β/γ**（会审席，仅 gavexA） | 3 个不同厂商/特质的模型 | 独立盲审、交叉质询、跑实证探针 | 互相抄结论；无探针证据的断言 |
| **Arbiter**（仲裁，仅 gavexA） | Main-Agent 兼任 | 汇总分歧、发起补充探针、宣布共识 | 在探针未闭合时宣布共识 |

> **铁律：运动员不能兼裁判。** 写代码的上下文与验代码的上下文必须物理隔离。

架构不绑定数字：阶梯为 `Step 1..N`，同阶并行规模为 `2..M`（受 `--max-workers` 和互斥条件约束），不具备并行条件时串行执行；3+1 是 Mode A 的默认会审席位配置。四大支柱是 Guarded Write-Scopes、Adversarial Cross-Audit、Verifier Veto Gates 与 Execution Pipeline，命名哲学见 [README](README.md#为什么叫-gavex设计哲学与命名拆解)。

---

## 4. Mode B 完整执行协议（gavexB）

```text
Step 0  Main-Agent 规划拆解  ──►  Write-Scope 矩阵冲突检查  ──►  台账落盘
   │
   ▼
Step K  (K = 1..N，严格串行)
   ├─ 并行派工 Worker K-A ‖ K-B ‖ … ‖ K-X    （2..M 名，非重叠 Write-Scope）
   ├─ 事件驱动等待 + 5 分钟低频 Watchdog 巡检
   ├─ 全员交卷 → 唤醒独立 Verifier K
   ├─ Verifier K 跑四大一票否决门禁
   │     ├─ 任一不过 → STEP_K_REJECTED → 定点打回 Worker K-X → 重修 → 再验
   │     └─ 全部通过 → STEP_K_VERIFIED_PASS ✅ → 解锁 Step K+1
   ▼
Final   Main-Agent 独立总验收（真实入口全链路回归） → GAVEX_FINAL_ACCEPTED
```

### 4.1 Step 0 · 规划拆解（Stage-Gated Planning）

Main-Agent 必须先产出并落盘以下三件东西，才能派出第一个 Worker：

1. **阶梯计划**：`Step 1 → Step N`，每一阶写明「目标 / 依赖的前序 Step / 交付物 / 验收条件」。拆分原则：
   - 底座先行：Schema、类型、配置、持久化层放在最前；
   - 每一阶的验收条件必须**可被命令验证**（测试命令、curl、构建、截图比对），不可验证的条件要改写；
   - 同一阶内的子任务之间**不得存在读后写依赖**，否则拆到下一阶。
2. **Write-Scope 矩阵**：每个 Worker 一行，列出允许写入的文件 / 目录 glob 白名单。
3. **验收清单**：每阶建议 5–9 条探针（Probe），以覆盖全部需求为准，不因条数上限删减；这些探针就是 Verifier K 的考卷，Worker 事先可见。

完成标准：三项产物均已落盘；Write-Scope 两两求交为空；每条需求都有可执行探针。

Write-Scope 冲突检查（派工前必须执行，任何一条命中都要重新拆分）：

```text
for each Step K:
  for each pair (Worker K-X, Worker K-Y), X ≠ Y:
    if glob(K-X.scope) ∩ glob(K-Y.scope) ≠ ∅           → COLLISION：同阶文件重叠
    if K-X.scope 包含 lockfile / 全局配置 / 迁移序号目录 → 该路径只能归属唯一 Worker
    if K-X 需要读取 K-Y 本阶的产出                     → DEPENDENCY：移到 Step K+1
```

### 4.2 Step K · 同阶非重叠并行派工

对每个 Worker 使用如下派单模板（字段不得省略）：

```markdown
[GAVEX Worker Brief] Worker K-X · <一句话目标>
- Mode: gavexB · Step K/N · Rework round: 0
- Objective: <可验证的目标>
- Write-Scope (ONLY these paths may be created/modified):
  - src/storage/**
  - migrations/0042_*.sql
- Read-Only: 其余全部路径
- Acceptance probes (Verifier K 将逐条实跑):
  1. `pnpm test storage` 退出码 0
  2. `node scripts/migrate.js --dry-run` 无破坏性 DDL
- Rules:
  1. 每完成一个文件立即落盘（增量 checkpoint），不在内存中攒到最后；
  2. 越出 Write-Scope 的需求：停止并在交卷中写明，由 Main-Agent 改派；
  3. 交卷只写：改动文件清单 / 自测命令与真实输出 / 未决风险；禁止写"已验证通过"。
```

派工规则：

- 同一 Step 的 Worker **同时**派出（一次性批量 `spawn`），每阶并行数 ≤ `--max-workers`；
- 不同 Worker 优先使用不同模型/档位，降低同质错误（例如 `openai/gpt-6.1-sol · max`、`anthropic/claude-opus-5-5 · max`、`google/gemini-4-argon · high`）；
- 派出后立即把 `runId / sessionKey / Write-Scope` 写入台账。

完成标准：本阶全部 Worker 都有独立句柄、互斥白名单、验收探针与可定位的落盘记录。

### 4.3 事件驱动 Watchdog（不忙轮询）

| 机制 | 行为 |
| --- | --- |
| **事件驱动等待** | 用 `wait(ids)` 抽象挂起，遵循 spawn 回执的完成路径（通知型等待事件，collector 型显式收集结果）；严禁 `sleep + 轮询状态` 的忙等。 |
| **5 分钟低频巡检** | 每 `--patrol` 间隔查看一次各 Worker 的落盘痕迹（文件 mtime、台账、最新输出），只看不打断。 |
| **停滞判定** | 连续 2 次巡检无新落盘且无输出 → 视为停滞。 |
| **Watchdog Steer** | 对停滞 Worker 发送收拢指令：`停止扩张范围，提交已落盘成果与阻塞证据，立即交卷。` |
| **越界拦截** | 巡检发现 Write-Scope 外文件被改 → 立即 steer 回滚该文件并记入台账，Verifier 必查。 |

完成标准：全员交卷或明确升级；等待按运行时实际支持的事件/结果收集方式闭环，不能把“running”当交卷。

### 4.4 Verifier K · 四大一票否决硬门禁

Step K 全员交卷后，Main-Agent 用**全新上下文**派出 Verifier K。任一门禁失败即整阶 `STEP_K_REJECTED`：

| 门禁 | 名称 | 判定标准 | 典型探针 |
| --- | --- | --- | --- |
| **G1** | 真实入口 · 拒绝白盒注入 | 必须从用户真实入口（CLI / HTTP / UI / 公开 API）端到端触发；禁止直接改内存状态、mock 掉被测对象或手写假数据来"证明"通过 | `curl -sf localhost:8080/api/sessions`、`pnpm e2e`、真实启动进程 |
| **G2** | 前端真实渲染 · 多视口 × 深浅色 | 涉及 UI 必须在 ≥ 3 个视口（如 390 / 1024 / 1440）× 深浅两色真实渲染并截图，检查溢出、错位、对比度与控制台报错 | 无头浏览器截图 + `console.error` 计数 = 0 |
| **G3** | 配置/数据零破坏 · Dry-run | 涉及配置、数据库、迁移、外部服务必须先干跑；比对前后快照，确认无破坏性写入 | `migrate --dry-run`、`terraform plan`、配置 diff |
| **G4** | 需求不缩水 | 逐条对照 Step 0 验收清单与原始需求；任何"先跳过""改成 TODO""降级为占位"都算失败 | 需求条目 ↔ 证据一一映射表 |

Verifier 派单模板：

```markdown
[GAVEX Verifier Brief] Verifier K · Step K 专职独立审验员
- 你不是本阶任何 Worker；全仓只读，禁止修改任何文件。
- 输入：Step K 目标与验收清单、各 Worker 交卷、Write-Scope 矩阵。
- 必做：
  1. `git diff --name-only` 核对改动文件 ⊆ 各 Worker Write-Scope 并集；越界即 REJECTED；
  2. 逐条实跑验收探针，记录「命令 / 退出码 / 关键输出」；
  3. 执行 G1–G4 四大门禁；
  4. 回归运行 Step 1..K-1 的关键探针，确认零回归。
- 输出（只能二选一）：
  - `STEP_K_VERIFIED_PASS` + 证据表
  - `STEP_K_REJECTED` + 缺陷清单（每条：现象 / 证据 / 违反门禁 / 归属 Worker K-X / 最小修复建议）
```

完成标准：独立 Verifier 输出且只输出一种裁决，并逐项附真实入口、命令、退出码与证据；不适用门禁须写明理由，不得静默跳过。

### 4.5 打回重修闭环（Rework Loop）

```text
STEP_K_REJECTED
  └─ Main-Agent 按缺陷归属，定点打回 Worker K-X（只派给有缺陷的 Worker，Write-Scope 不变）
       └─ Worker K-X 重修（Rework round +1），交卷附「缺陷 → 修复 → 自测输出」对照
            └─ 新的 Verifier K'（全新上下文）全量复核：全部探针 + G1–G4 + 前序回归
                 ├─ PASS     → STEP_K_VERIFIED_PASS ✅ → 解锁 Step K+1
                 └─ REJECTED → 继续循环；round > --max-rework → 升级给用户，附全部证据
```

- 复核必须**全量重跑**，不能只验被修的那一条（防止修 A 坏 B）。
- 缺陷若归属于 Write-Scope 设计本身（需要改他人范围）→ 由 Main-Agent 停止受影响派工，重新核对互斥范围并在台账记录变更；不能让 Worker 自行越界。
- 重修超限或范围冲突无法自决时，Main-Agent 签发 `GAVEX_ESCALATED`，附证据并请求用户决定，禁止提前解锁下一阶。

完成标准：全量复核拿到 `STEP_K_VERIFIED_PASS`，或以 `GAVEX_ESCALATED` 明确阻塞；两者不可混写。

### 4.6 Final · Main-Agent 独立总验收

全部 Step 通过后，Main-Agent 亲自（或另派 Final Verifier）执行：

1. 从真实入口跑完整用户链路；
2. 重跑全部 Step 的探针集合（全量守门核验，目标 100% 闭合）；
3. 汇总台账与报告，签发 `GAVEX_FINAL_ACCEPTED`，然后才向用户交付。

完成标准：所有阶梯已通过、全量探针闭合、真实链路复跑成功且报告落盘；任一失败不得签发最终接受令牌。

---

## 5. Mode A 完整执行协议（gavexA · 3+1 异构对抗会审）

1. **独立盲审**：同时派出 Reviewer α / β / γ（三个不同厂商或思维特质的模型），给相同的问题材料，互不可见。每人必须输出：结论、根因假设、可执行的实证探针、置信度。
2. **交叉质询**：Arbiter 把三份结论匿名互换，每人针对他人结论给出"支持 / 反驳 + 反例探针"。
3. **实证闭合**：所有探针在真实环境实跑；无法复现的论点直接作废。
4. **动态收敛**：不硬凑轮数。当探针 100% 闭合且三席结论一致 → 签发 `UNCONDITIONAL_CONSENSUS`；否则只针对分歧点开下一轮，最多 3 轮，仍有分歧则把分歧与证据原样呈给用户。

`gavexAB` = 先跑 Mode A 产出被共识的方案，再把方案作为 Mode B Step 0 的输入。

完成标准：探针 100% 闭合且三席一致才签发 `UNCONDITIONAL_CONSENSUS`；仍有分歧时提交分歧与证据，不得进入施工并谎称共识。

---

## 6. 判定令牌（Verdict Tokens）

令牌是机器可解析的状态锚点，只能由指定角色签发，必须单独成行：

| 令牌 | 签发者 | 含义 |
| --- | --- | --- |
| `STEP_K_VERIFIED_PASS` | Verifier K | Step K 全部探针与门禁通过，解锁 Step K+1（K 替换为数字，如 `STEP_3_VERIFIED_PASS`） |
| `STEP_K_REJECTED` | Verifier K | Step K 存在缺陷，附缺陷清单与归属 |
| `UNCONDITIONAL_CONSENSUS` | Arbiter | gavexA 会审在探针闭合下达成无条件共识 |
| `GAVEX_FINAL_ACCEPTED` | Main-Agent | 全流程总验收通过，可以交付 |
| `GAVEX_ESCALATED` | Main-Agent | 重修超限或范围冲突无法自决，升级给用户 |

---

## 7. Write-Scope 防踩踏规范

1. **白名单制**：只列允许写的路径；未列出的一律只读。
2. **同阶互斥**：同一 Step 内任意两个 Worker 的 Write-Scope 交集必须为空。
3. **热点文件唯一归属**：`package.json`、lockfile、全局配置、路由注册表、迁移序号目录、i18n 总表等"汇聚型文件"只能分给一个 Worker；其他 Worker 需要改动时，在交卷中写出补丁意图，由归属者或下一阶统一合入。
4. **生成物隔离**：构建产物、快照、缓存不进入任何 Write-Scope，由 Verifier 现场生成。
5. **越界即否决**：Verifier 以 `git diff --name-only`（或文件 mtime 快照对比）为准；越界改动无论好坏都打回。
6. **跨阶可重叠**：Step K+1 可以改写 Step K 的文件，因为 Step K 已经封版通过。

---

## 8. 台账与报告（Ledger）

Main-Agent 在 `--ledger`（默认 `.gavex/ledger.md`）维护唯一事实来源，每个关键事件追加一行：

```markdown
| 时间 | Step | 事件 | 主体 | 证据 / 产物 |
| --- | --- | --- | --- | --- |
| 21:04 | 0 | PLAN_LOCKED | Main-Agent | 6 steps · 14 workers · 42 probes |
| 21:06 | 1 | SPAWN | Worker 1-A/B/C | runIds: r-1a, r-1b, r-1c |
| 21:19 | 1 | STEP_1_REJECTED | Verifier 1 | G3: migrate dry-run 产生 DROP COLUMN → 归属 1-B |
| 21:27 | 1 | STEP_1_VERIFIED_PASS | Verifier 1' | 7/7 probes · 0 regressions |
```

最终报告结构：目标与范围 → 阶梯计划 → Write-Scope 矩阵 → 逐阶验工证据（含打回历史）→ 全量探针结果 → 遗留风险 → `GAVEX_FINAL_ACCEPTED`。

报告中的进度数据可以直接喂给 Dashboard（`docs/dashboard/index.html`）进行可视化。

---

## 9. 平台适配（Platform Adapters）

推荐克隆目录为 `~/Developer/GAVEX`，单文件安装统一使用 `skills/gavex/SKILL.md`（各平台配置目录前缀见下表）。完整安装命令见 [README · 快速安装](README.md#快速安装)。

| 平台 | 安装位置（推荐） | spawn | wait | 备注 |
| --- | --- | --- | --- | --- |
| **OpenClaw** | `~/.openclaw/skills/gavex/SKILL.md` 或工作区 `skills/gavex/SKILL.md` | `sessions_spawn` | `agents_wait` / `sessions_yield` | 可用 Code Mode 一次性批量派工；Watchdog 用 steer 收拢 |
| **Claude Code** | `~/.claude/skills/gavex/SKILL.md` 或项目 `.claude/skills/gavex/SKILL.md` | `Task`（同一条消息内并行多个） | `Task` 结果返回 | Verifier 用独立 subagent 定义，只授予只读 + Bash 工具 |
| **OpenCode** | `~/.config/opencode/skills/gavex/SKILL.md` 或项目 `.opencode/skills/gavex/SKILL.md` | subagent（`@` 调用 / task 工具） | 子会话返回 | 可为 Verifier 配置 `edit: deny` 权限 |
| **Pi** | `~/.pi/agent/skills/gavex/SKILL.md` | sub-agent 扩展 / 新会话 | 会话结果 | 无 sub-agent 时走单 Agent 串行降级 |
| **DSH** | 平台配置的 skills 目录下 `gavex/SKILL.md` | 平台 delegate 原语 | 平台 join 原语 | 遵循本文件三原语抽象即可 |
| **Hermes** | `~/.hermes/skills/gavex/SKILL.md` | `delegate_task` 等子代理工具 | 子任务返回 | Verifier 建议使用与 Worker 不同的 provider |

**单 Agent 串行降级**（平台无法派子代理时）：按 Step 顺序自己施工；每个 Step 结束后**清空工作假设**，以"审验员"身份重新读取 diff 与需求，逐条实跑探针，并显式输出判定令牌。降级模式必须在报告中注明 `degraded: single-agent`；自我复核不等同于真正的独立上下文物理隔离，必须明确披露这一保证较弱，不能冒充多代理独立验工。

---

## 10. 反模式清单（出现即视为协议违规）

- ❌ 把 N 个模块塞进一个巨型 Prompt 一次放出；
- ❌ Step K 未拿到 `STEP_K_VERIFIED_PASS` 就启动 Step K+1；
- ❌ 同阶两个 Worker 的 Write-Scope 重叠，或共享 lockfile；
- ❌ Worker 自评"测试全过"后由 Main-Agent 直接转述交付；
- ❌ Verifier 修改代码"顺手修好"——Verifier 只能判定，不能施工；
- ❌ 复核只验被打回的那一条，不做全量回归；
- ❌ 用 `sleep` 循环忙等子代理；
- ❌ 以"时间不够"为由把需求降级为 TODO / 占位。

---

## 11. 最小示例

```text
用户：gavexB 把 Gateway 会话调度重构为事件驱动，并补齐 Dashboard 面板

Main-Agent（Step 0）：
  Step 1 底座：配置 Schema / 持久化迁移 / 共享类型        → Worker 1-A, 1-B, 1-C
  Step 2 会话调度核心：事件总线 / 调度器                   → Worker 2-A, 2-B
  Step 3 工具沙箱与审批                                     → Worker 3-A, 3-B, 3-C
  Step 4 Watchdog 巡检与 Steer                              → Worker 4-A, 4-B
  Step 5 Dashboard 面板                                     → Worker 5-A, 5-B
  Step 6 文档、发布与回归套件                               → Worker 6-A, 6-B
  合计 6 步 · 14 Workers · 6 Verifiers · 42 probes；Write-Scope 矩阵冲突检查 0 命中

Verifier 1：G3 发现迁移 dry-run 含 DROP COLUMN → STEP_1_REJECTED → 打回 Worker 1-B
Worker 1-B：改为 ADD COLUMN + 回填脚本，自测 dry-run 无破坏
Verifier 1'：7/7 probes 全绿，前序回归 0 → STEP_1_VERIFIED_PASS ✅ → 解锁 Step 2
...
Main-Agent（Final）：42/42 全量守门核验闭合 → GAVEX_FINAL_ACCEPTED
```
