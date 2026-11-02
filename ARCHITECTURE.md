# GAVEX — 架构设计与独立验工协议

**G**uarded **A**udit & **V**erifier-gated **EX**ecution

**让子代理在互斥边界内并行施工，让独立守门员握着法槌一票否决。**

*Parallel workers build inside guarded scopes. An independent verifier holds the gavel.*

> **定位**：一套完全独立于具体业务形态的 **通用多智能体分步并发与独立守门员验工协议（Universal Execution Skill & Dashboard）**。既可作为单 Agent 派发临时 Sub-agents 的标准作战 Skill（适用于 OpenClaw、Claude Code、OpenCode、Pi、DSH、Hermes）。

---

## 1. 核心解决痛点

传统单 Agent 派发子代理（Sub-agents）常见的三大灾难：
1. **一锅端大爆炸**：把十几个模块的改动塞进一个巨型任务同时放出，前序底座没稳，后续模块全在错误假设上盲改；
2. **并发踩踏（Write-Scope Collision）**：多个 Worker 同时修改同一个文件或争抢同一个全局状态锁，互相覆盖代码；
3. **运动员兼裁判（Self-Grading Hallucination）**：写代码的 Worker 自己跑个假测试就宣称“100% 完成”，主代理直接当传声筒交付给用户，结果一跑全崩。

---

## 2. 核心架构：双模式（Mode A 会审 + Mode B 阶梯并行施工）

### 2.1 模式 A：3+1 异构对抗会审（`gavexA` · Adversarial Cross-Audit）
- **3 席异构盲审团**：同时派出 3 个不同厂商/不同思维特质的模型对疑难 Bug 或架构方案独立盲审、交叉辩论与实证探针验证；
- **动态收敛**：不硬凑轮数，一旦实测探针 100% 闭合且达成 `UNCONDITIONAL_CONSENSUS` 即刻收工。

### 2.2 模式 B：阶梯门禁 + 非重叠并行施工 + 专职独立守门员（`gavexB` · Step 1 → Step N Pipeline）
1. **Main-Agent 全局拆解与阶梯扣留（Stage-Gated Planning）**：
   - 主代理将复杂工程按先后依赖拆解为 `Step 1 → Step 2 → ... → Step N`；
   - **严格按序解锁**：在 `Step K` 未拿到独立验工签发的 `STEP_K_VERIFIED_PASS` 印章前，严禁提前启动 `Step K+1`。
2. **同阶非重叠并行分派（Non-Overlapping Write-Scope Parallelism）**：
   - 在每一个 `Step K` 内部，主代理将互不冲突的子任务并行派发给 `2..M` 名 Worker；`Worker K-A`、`Worker K-B`、`Worker K-C` 只是命名示例，默认上限 3 可用 `--max-workers` 调整；
   - 每个 Worker 强制绑定物理隔离的 **`Write-Scope`（允许修改的文件/目录白名单）**，并在执行过程中遵守增量落盘铁律与事件驱动 Watchdog 巡检。
3. **专职独立验工守门员（Independent Verifier K）**：
   - 当 `Step K` 的所有并行 Worker 交卷后，主代理唤醒完全独立的 **`Verifier K`（严禁由 Worker 自审）**；
   - `Verifier K` 强制执行 **四大一票否决硬门禁**：
     1. 严禁白盒注入假状态，必走真实入口端到端验证；
     2. 涉及前端必做多视口/深浅色真实渲染与几何对齐核验；
     3. 涉及配置/数据库必做干跑（Dry-run）零破坏核验；
     4. 严禁私自缩水需求范围。
   - 发现任何半点瑕疵，当场签发 `STEP_K_REJECTED` 并精准打回对应 `Worker K-X` 重修，直至全项通过签发 `STEP_K_VERIFIED_PASS ✅`，最后由 Main-Agent（或另派独立 Final Verifier）完成总验收并签发 `GAVEX_FINAL_ACCEPTED` 结案。

### 2.3 组合入口与默认路由

| 指令 | 执行路径 | 完成条件 |
| --- | --- | --- |
| `gavex <目标>` | 默认等同于 `gavexB` | 逐阶通过并完成总验收 |
| `gavexA <问题>` | 多模型盲审 → 匿名交叉质询 → 实证探针闭合 | `UNCONDITIONAL_CONSENSUS` |
| `gavexB <目标>` | Step 0 规划 → Step 1..N → Final | `GAVEX_FINAL_ACCEPTED` |
| `gavexAB <目标>` | 先 Mode A 达成共识，再以结论驱动 Mode B Step 0 | 共识、逐阶门禁与总验收全部闭合 |

Mode A 默认 3 席异构 Reviewer + 1 名 Arbiter；它不限制阶梯数或 Worker 数。若会审未闭合，不得假借“全套模式”直接开工。`--dry` 只输出阶梯计划与 Write-Scope 矩阵，不派出 Worker。

---

## 3. 四大架构支柱与不可变条件

| 字母 | 支柱 | 必须成立的架构约束 |
| --- | --- | --- |
| G | Guarded Write-Scopes | 同阶任意两个 Worker 的写入集合交集为空；白名单外只读，热点文件唯一归属 |
| A | Adversarial Cross-Audit | `gavexA` 的各席先独立盲审，再匿名质询；任何共识都必须有真实探针证据 |
| V | Verifier Veto Gates | `Verifier K` 为全新上下文、全仓只读；不得是本阶 Worker，G1–G4 任一失败即可否决 |
| EX | Execution Pipeline | `Step 1 → Step N` 棘轮解锁；无 `STEP_K_VERIFIED_PASS` 不得启动下一阶 |

阶梯为 `Step 1..N`，同阶并行规模可为 `2..M`，独立任务不足时串行。恒定的是**施工与验工的物理隔离**、**互斥写域**与**逐阶互锁**，不是参与人数。法槌意象与完整命名拆解见 [README · 为什么叫 GAVEX](README.md#为什么叫-gavex设计哲学与命名拆解)。

---

## 4. 角色、数据流与重修闭环

| 角色 | 权限与责任 | 不可跨越的边界 |
| --- | --- | --- |
| Main-Agent | 拆阶梯、锁定范围、派工、记录句柄与证据、组织独立总验收 | 不替 Worker 自评背书，不亲自混入业务施工 |
| Worker K-X | 只写授权白名单；每完成一个文件立即落盘；自测后交卷 | 不写他人范围，不签发验工令牌 |
| Verifier K | 全仓只读；从真实入口逐条跑探针、G1–G4 与前序回归 | 不修改业务文件，不“顺手修好”，不降低需求 |
| Reviewer / Arbiter | 独立建模、匿名质询、闭合证据后宣布共识 | 不以模型多数票取代实测，不把未解分歧包装为一致 |

1. **Step 0 锁定**：落盘阶梯目标、依赖、逐条验收探针与 Write-Scope 矩阵；展开 glob 并检查同阶交集。共享 lockfile、路由总表、迁移序号目录等只归属一个 Worker；存在本阶读后写依赖就拆到下一阶。
2. **本阶并行**：批量派出互不冲突的 Worker，立刻记录 `runId / sessionKey / Write-Scope`。按 spawn 回执使用事件通知或显式结果收集，禁止忙轮询。
3. **Watchdog**：默认 `--patrol=5m`，仅查看落盘与输出；连续两次无进展即 steer 收拢，提交已有成果与阻塞证据。发现越界先停止受影响派工、核对归属并记账，不能覆盖他人的有效改动。
4. **独立验工**：全员交卷后唤醒 `Verifier K`，记录每条命令、真实退出码与关键输出。G1 真实入口；G2 涉及 UI 时三视口 × 深浅色真实渲染；G3 涉及配置/数据时先 dry-run 与快照比对；G4 原始需求逐条映射。门禁不适用须明示理由。
5. **打回重修**：`STEP_K_REJECTED` 必须标出缺陷、违反门禁与归属 Worker K-X；定点返工不扩大 Write-Scope。重修后由全新上下文 Verifier 全量重跑全部探针、G1–G4 与前序回归，不只验被修项。
6. **解锁或升级**：`STEP_K_VERIFIED_PASS` 才解锁下一阶；默认 `--max-rework=3`，重修超限或范围冲突无法自决则签发 `GAVEX_ESCALATED` 并把证据交给用户。全部阶梯通过仍须从真实入口全链路总验收。

---

## 5. 机器可解析的判定令牌

令牌独立成行，禁止由 Worker 代签；其中 K 在实际报告中替换为阶梯编号。

| 令牌 | 签发者 | 状态含义 |
| --- | --- | --- |
| `STEP_K_VERIFIED_PASS` | Verifier K | 本阶验工全通过，解锁下一阶 |
| `STEP_K_REJECTED` | Verifier K | 本阶缺陷待修，后续仍锁定 |
| `UNCONDITIONAL_CONSENSUS` | Arbiter | 会审探针闭合、结论一致 |
| `GAVEX_FINAL_ACCEPTED` | Main-Agent | 全阶梯与最终真实链路验收通过 |
| `GAVEX_ESCALATED` | Main-Agent | 阻塞超出自主决策范围，交回用户 |

---

## 6. 安装、台账与可视化边界

- **推荐安装**：克隆到 `~/Developer/GAVEX`，技能入口统一为 `skills/gavex/SKILL.md`；各运行时的路径前缀与安装命令见 [README · 快速安装](README.md#快速安装) 和 [SKILL · 平台适配](SKILL.md#9-平台适配platform-adapters)。
- **唯一事实来源**：`--ledger` 默认 `.gavex/ledger.md`，记录规划锁定、派工句柄、等待、巡检、打回、复核、通过与升级；每个裁决都能反查证据。
- **协议定义**：[SKILL.md](SKILL.md) 是可安装执行协议；本文件解释架构，不引入另一套命令或令牌。
- **可视化**：[Dashboard](docs/dashboard/index.html) 消费台账与报告状态。回放动画不是验工证据，KPI 的 6 阶 / 14 Workers 只是演示数据，不是协议常量。
- **能力降级**：无子代理能力的平台可显式报告 `degraded: single-agent` 并按 Step 串行、自我复核；这不等同于真正的独立上下文隔离，报告必须披露其保证较弱，不能伪装成多代理独立验工。
