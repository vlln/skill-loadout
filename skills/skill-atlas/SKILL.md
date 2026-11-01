---
name: skill-atlas
description: >
  Use when placing a skill on a coordinate, judging whether two skills overlap or
  could be swapped, splitting a skill that answers two different questions, or
  assembling a small set of skills for one kind of task. Also for auditing how a
  batch of existing skills is distributed.
license: MIT
metadata:
  face: quality
  author: vlln
  version: "0.3.0"
---

# 定位一份 skill

定位只问一件事：**它主要回答哪个问题。** 它用来做什么，写在 `description` 里，比任何标签都重要。

## 三个问句

| 面 | 问句 | 它产出 |
|---|---|---|
| `process` | 什么时候做、由谁决定、承诺是什么、怎么交接 | 承诺、授权、关口、变更与恢复点 |
| `quality` | 凭什么算合格、怎么写画得更好 | 判据、评审结论、写作与界面判断 |
| `execution` | 用什么做、跑哪条命令、产物在哪 | 命令、工具、环境、证据 |

按活动分类必然重叠（评审既排流程又下判断），按提问分类才分得开。

**质量里常见两类内容**：合格线（什么算错）与写法（怎么写更好）。它们同属质量面，不用分别贴标签，也不用因为混着就拆开；只要读者分得清哪句是合格线、哪句是写得好。

## 一条规则只回答一个问题

肥句是常态。"每个非平凡改动必须在同一个 PR 内新增一条记录"——前半句是流程（何时做），后半句是质量（记录长什么样）。见到这种句子，先拆句，再归属；不要因为它跨面就断定分类不够用。

## 严格到什么程度

这套分类是判断用的，不追求把每条规则完整切开。

- 一份 skill 可以顺手带上别的面的信息，只要它不冒充那个面的权威：流程 skill 可以说"验收要看证据"，但不定义证据怎么判。
- 一条碎规则放不进去时，留在原地；为一条规则新建一份 skill，多加载的上下文比它省下的混乱更贵。
- 判断不清时问"它主要回答哪个问题"，而不是"它能不能被完全归类"。
- 底线只有一条：不要让两份 skill 对同一段指令都声称拥有权威。

## 标注

主面写进 `metadata`，不新增顶级字段：

```yaml
metadata:
  face: quality      # process | quality | execution
```

标不出来，先看是不是句子太肥；拆完还分不清，按它主要服务的那个问题标。

## 四个动作

**定位一份。** 读它回答的问题，给结论：`它主要回答 X，用途是 Y，另外触及 Z（拆分候选）`。触及的 Z 要具体到句子，不要只写面名。

**判断重叠。** 两份 skill 命中同一个问句、覆盖同一段指令，就是重叠；同一条规则在两个文件里各写一遍，是复制，最终会漂移。可比性不看篇幅，只看问句、用途与覆盖范围。

**拆分。** 沿"流程 / 质量 / 执行"的缝切；质量内部的两类内容只需在正文分区，不必拆成两份。切完检查：有没有一条规则两边都放不下？有，说明缝切错了。

**配一组。** 为一个任务配齐三面——这几份合起来叫一个 loadout，它不落盘、用完即散。共用规则各自写最小充分版，不用引用连接；最后用三句真实请求试一遍，看会不会同时命中两份。
