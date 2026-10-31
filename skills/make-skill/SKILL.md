---
name: make-skill
description: >
  Use when writing, rewriting, or judging one Agent Skill: its frontmatter
  contract, its trigger description, its body structure, and how to prove it
  works. Not for deciding whether a skill is worth building, splitting one into
  several, versioning or publishing it, or running the installer — those belong
  to the process and execution faces of the same task.
face: quality
scope: subject
license: MIT
metadata:
  author: vlln
  version: "2.0.0"
---

# 写一份 skill

这份 skill 只回答两件事：**什么样算合格**，**怎么写更好**。它不回答要不要做、什么时候发、装在哪里。

## 事实：它是什么，怎么被加载

- 一个 skill 是一个目录，至少含 `SKILL.md`；可选 `scripts/`、`references/`、`assets/`。
- 加载分三层，成本递增：启动时只读 `name` + `description`（每份约 100 tokens）；激活时读整个正文（自设目标：500 行、5,000 tokens 以内）；`references/`、`scripts/`、`assets/` 只在指令要求时读或运行。
- **宿主是最终权威。** 发现根、支持的字段、截断长度都随宿主不同且在变。下面的事实标注核对日期（2026-10-19）；换宿主或升级后重核，不要凭记忆。
- 可移植的核心字段只有六个：`name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`。其余是宿主扩展，用了就失去可移植性。
- 上面三条来自规范与宿主行为，不是本 skill 的发明；标注日期的原因见下一节最后一条。

## 判据：合格线

**frontmatter**

- `name` 与所在目录名一致；1–64 字符，小写字母、数字、连字符，无首尾或连续连字符。
- `description` 写清"做什么 + 何时用"，≤1024 字符。与宿主追加的触发说明合并后会被截断，所以最关键的用例放最前。
- YAML 必须从文件第 0 字节开始。BOM 或前置空行会让整份 frontmatter 失效，文件被当成纯指令。
- 值里含 `: ` 或 `#` 时加引号。未引号的冒号是最常见的静默失败。

**三角色不互串**

| 读者 | 文件 | 不该出现 |
|---|---|---|
| 决定是否安装的人 | 仓库 README | agent 工作流、内部设计理由 |
| 使用它的 agent | `SKILL.md` + `references/` | 安装说明、维护者笔记 |
| 维护者 | README 旁注、`docs/` | 运行期才需要的指令 |

**校验必须能失败**

- 机械检查（frontmatter 可解析、`name` 与目录一致、行数在限内）只证明格式对，不证明能用。
- 至少做一次负控：故意改坏一处（删掉 `description`、改错 `name`、把两件无关的事塞进一个触发），确认检查会报错。**从不失败的校验不是证据。**
- 行为验证：拿三句真实请求试触发——两句该命中，一句近邻不该命中。只看"能不能加载"不算验证。

**事实要带来源与日期。** 任何"某某宿主支持 / 最多多少字符 / 现在是最新版"的断言，写上核对日期；否则它比规则先过期。

## 风格：怎么写更好

**description**

- 用"当……时使用本 skill"的祈使句，写用户想达成的事，不写内部机制。
- 首句必须能被匹配：把"何时用"放最前，把实现细节留给正文。
- 点名近邻——写出"不适用"的情形，比堆同义词有效。
- 一条描述需要 `and` 连接两件无关的工作，就是该拆的信号。

**正文**

正文只承担五样东西：流程、默认值、脆弱约束、gotchas、校验回环。其余（通用知识、标准工具用法、复述文档）都是上下文税。

常见的五种组织方式，按任务选一种，不要混着堆：

| 模式 | 形状 | 适合 |
|---|---|---|
| 工具封装 | 触发词 → 能力 → 指向 `references/` | 包一个 CLI 或 API |
| 生成器 | 读风格指南 → 套模板 → 按清单校验 | 标准化产物 |
| 审查器 | 固定流程 + 可替换的检查清单 | 评审、审计 |
| 反问式 | 目标 → 约束 → 执行，每阶段确认 | 猜测比提问更贵时 |
| 流水线 | 每阶段产出经校验的中间结果 | 顺序不可乱的多步工作 |

- 超过 500 行或 5,000 tokens 再拆 `references/`；每个 reference 必须有"何时读它"的指令，否则它永远不会被读。
- gotcha 的定义是"违反合理假设的具体事实"：写现象、原因、最小修法。写"注意边界"等于没写。
- 控制力度随脆弱度走：多解可用时讲理并给默认；命令精确、顺序脆弱时钉死。
- 反模式：把清单当完成标准；用"确保""注意"代替判据；正文里塞安装说明；为凑完整性加文件。

## 输出

写完或审完，给出四项：它回答哪个问句、作用域是什么、哪些句子是事实（带来源日期）、哪些是判据与风格。再加一句"不负责什么"，让下一份能接上。

## 不负责

要不要做、怎么拆、何时升版本与发布，属于流程面；安装、清单、命令与目录，属于执行面。本文只在必要处提到它们，不复述其规则。
