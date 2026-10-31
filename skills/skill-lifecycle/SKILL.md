---
name: skill-lifecycle
description: >
  Use when deciding whether a skill is worth building, whether one skill should
  be split into several, when its version changes, and when it may be published
  or needs re-verification. Owns the sequence, the decision points, and who
  authorizes each step; it does not define what a good skill looks like, nor how
  to install or run one.
license: MIT
metadata:
  face: process
  scope: method
  author: vlln
  version: "2.0.0"
---

# 一份 skill 的生命周期

这份 skill 管什么时候做哪一步、谁决定、交接什么。合格线与写法在质量面，命令与目录在执行面。

## 决定：要不要做

做，当至少一条成立：

- 同一套指令、清单或多步流程反复被粘进对话；
- 需要模型猜不到的领域或项目知识；
- 顺序脆弱、命令精确、有校验关口；
- 要在多个仓库或宿主之间共享。

不做，当任一条成立：

- 一次性任务，直接做；
- 是稳定偏好，该进常驻规则（`AGENTS.md`）而不是 skill；
- 模型已经做得很好——加了只占上下文，还可能误触发；
- 内容其实是某个工具的实现，包起来比写散文划算。

写不出一句话说明"它替谁省掉什么"，就是不该做。

## 拆：一份还是几份

拆的信号：

- 两个任务永远不会同时激活；
- `description` 必须用 `and` 连接两件无关的工作；
- 维护者说不清某次改动该改哪一份。

**不是**拆分信号的：两份 skill 抢同一个触发。那是描述问题，先改描述。

拆完每份都要写清"不负责什么"，共享的内容引用不复制。

## 顺序与交接

| 阶段 | 产出 | 过关条件 | 谁决定 |
|---|---|---|---|
| 决定 | 一句话：反复出现的任务 + 知识缺口 | 一段常驻规则不足以替代它 | 人，或人明确委托 |
| 起草 | `SKILL.md` 初稿 | 描述能一句话说清何时用 | agent，按质量面规则 |
| 验收 | 检查结果 + 三句触发测试 | 负控会失败；该中的中，近邻不中 | agent；异常交人 |
| 发布 | 可安装的源 + README | 干净环境照 README 能装成 | **人** |
| 维护 | 版本与复查记录 | 事实未过期，或已更新 | agent 提议，人确认发布 |

发布、推送公共仓库、加展示徽章、声明兼容性，都是需要人明确同意的动作；之前的同意不延伸到新动作。前面的阶段可以在一次对话里连续完成，但**讨论、采纳、执行是三件事**，不要用"看起来可以"代替"可以发布"。

## 版本

- 只改措辞、不加判断 → patch。
- 新增指导，或改变某类任务的做法 → minor。
- 改契约：描述语义、输入输出、依赖、兼容性 → major。
- 未发布的实验不升版本。版本号跟着已发布的状态走，不跟着提交次数走。

## 维护与复查

复查触发：宿主或规范升级；引入新依赖；满一个复查周期（默认 60 天，按项目调）；出现"本该触发却没触发"或"触发了但没用"的反馈。

复查只做三件事：重核带日期的事实、看描述是否仍命中真实请求、删掉不再成立的建议。不要为了显得在维护而增加内容。

## 不负责

合格线与写法属于质量面；安装、清单、命令、目录属于执行面。本文提到它们时只点名，不复述其规则。
