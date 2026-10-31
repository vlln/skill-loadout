---
name: make-skill
description: >
  Use when writing, rewriting, or judging one Agent Skill: frontmatter contract,
  trigger description, body structure, file references, and how to prove it
  works. Covers the Agent Skills specification plus this project's extensions
  (content face, scope, fact-versus-rule separation). Not for deciding whether to
  build a skill, splitting one, versioning or publishing it, or running the
  installer.
license: MIT
metadata:
  face: quality
  scope: subject
  author: vlln
  version: "2.1.0"
---

# 写一份 skill

这份 skill 只回答两件事：**什么样算合格**，**怎么写更好**。事实与规范分开写，事实带核对日期。

## 事实：官方规范怎么说

来源：Agent Skills 规范与 skill-creation 指南（`agentskills.io`），核对 **2026-10-19**。宿主是最终权威，换宿主或升级后重核。

| 字段 | 必须 | 约束 |
|---|---|---|
| `name` | 是 | 1–64 字符，仅 `a-z0-9-`，首尾及连续连字符禁止，且必须等于父目录名 |
| `description` | 是 | 1–1024 字符，写清"做什么"和"何时用" |
| `license` | 否 | 许可名，或指向随包许可文件 |
| `compatibility` | 否 | 1–500 字符，环境要求；多数 skill 不需要 |
| `metadata` | 否 | 字符串键值表——客户端自定义属性的**官方位置** |
| `allowed-tools` | 否 | 空格分隔的预批准工具，实验性，各客户端支持不一 |

- 渐进披露三层：启动只读 `name` + `description`（约 100 tokens/份）；激活读整个正文（建议 <5,000 tokens）；`scripts/`、`references/`、`assets/` 按需加载。正文建议 <500 行。
- 文件引用用**相对 skill 根目录的路径**，层级保持一层。
- 官方 `skills-ref validate <dir>` 只校验 frontmatter 与命名，不校验内容质量。

## 判据：合格线

**frontmatter**

- 六个字段名照抄规范，不自造顶级字段：自定义内容一律进 `metadata`（严格客户端会拒绝未知顶级字段）。
- YAML 必须从文件第 0 字节开始：BOM 或前置空行会让整份 frontmatter 失效，文件被当成纯指令。
- 值里含 `: ` 或 `#` 时加引号。未引号的冒号是最常见的静默失败。

**三角色不互串**

| 读者 | 文件 | 不该出现 |
|---|---|---|
| 决定是否安装的人 | 仓库 README | agent 工作流、内部设计理由 |
| 使用它的 agent | `SKILL.md` + `references/` | 安装说明、维护者笔记 |
| 维护者 | README 旁注、`docs/` | 运行期才需要的指令 |

**校验必须能失败**

- 机械校验（`skills-ref validate`、name 与目录一致、行数在限内）只证明格式对，不证明能用。
- 至少做一次负控：故意改坏一处（删 `description`、改错 `name`、把两件无关事塞进一个触发），确认检查会报错。**从不失败的校验不是证据。**
- 行为验证：三句真实请求试触发——两句该命中，一句近邻不该命中。

**事实带来源与日期**：任何"宿主支持 / 最多多少字符 / 现在是最新版"的断言都标核对日期，否则它比规则先过期。

## 扩展：本项目加在规范之上的三条

规范没规定下面这些；它们是本项目的规矩，用 `metadata` 承载，不改规范的字段语义。

1. **面与作用域标在 `metadata` 里**，不新增顶级字段：

```yaml
metadata:
  face: quality      # process | quality | execution
  scope: subject     # method | subject | instance
```

2. **正文形状由面决定**，不套固定的模式菜单（见下一节）。
3. **事实与规范分开写**：事实单独成段并带日期；规则里不夹"某某支持"这类断言。

## 风格：正文按面长出来

先定主面，再决定正文形状——这比"选一种模式"稳定，因为面来自它回答的问题，不来自作者偏好：

| 面 | 正文写什么 | 不写什么 |
|---|---|---|
| `process` | 顺序、关口、谁决定、交接物 | 具体命令、判定细则 |
| `quality` | 判据、风格、反例、负控 | 何时做、装在哪 |
| `execution` | 命令、参数、产物、验什么 | 写作判据、审批 |

跨面内容一律写成"不负责什么"并指路，不复述对方规则。

可用的技巧，按需要挑，不是清单：

- **gotchas**：违反合理假设的具体事实——现象、原因、最小修法。放正文，别放深的 reference。
- **模板**：要固定输出格式时给具体骨架，比散文描述可靠。
- **清单**：多步且有依赖或关口时给。
- **校验回环**：做完跑校验，失败就修，通过才继续。
- **先计划后执行**：批量或破坏性操作，先产出计划，对照事实校验后再执行。

写作口径：

- 只写模型不写就会做错的东西。通用知识、标准工具用法、复述文档都是上下文税。
- 默认给一个，另给一条后路；不要摆一堆等权选项。
- 多解可用时讲理并给默认，脆弱处（精确命令、顺序、格式）钉死。
- 一段讲一件事；判据用"必须 / 不得 / 应当"，不用"注意""确保"。

## 输出

写完或审完给四项：它回答哪个问句；作用域是什么；哪些句子是事实（带来源日期）；哪些是判据与风格。再加一句"不负责什么"，让下一份接得上。

## 不负责

要不要做、怎么拆、何时升版本与发布属于流程面；安装、清单、命令与目录属于执行面。本文只在必要处点名，不复述其规则。
