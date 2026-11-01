# skill-loadout

用一个问题给 skill 的内容定位：**它主要回答哪个问题**（面）。

一个任务可能需要几份 skill，各回答不同的问题；已经存在的 skill 可以被归位、比较、判断是否重叠。

**用 `atlas` 定位，用 `loadout` 组装**：前者是判断与地图，后者是一个任务实际加载的那几份。项目名取后者——这个仓库产出的是"可组装的一组"，不是一个工具。

## 当前状态

**理论已定骨架，开始验证。** [THEORY.md](THEORY.md) 是唯一权威；[docs/placement-audit.md](docs/placement-audit.md) 是对 23 份真实 skill 的归位审计，也是这套坐标第一次被现实检验。

已创建四份 skill，覆盖三个面：

| 技能 | face | 管什么 |
|---|---|---|
| [skill-atlas](skills/skill-atlas/SKILL.md) | `quality` | 定位、判重叠、拆分、配组；正文按面长出来的标准 |
| [skill-writing](skills/skill-writing/SKILL.md) | `quality` | 写一份 skill：字段契约、描述、正文、引用的合格线与写法 |
| [make-skill](skills/make-skill/SKILL.md) | `process` | 制作流程：决定、提取、拆分、验收与查询集、发布、维护 |
| [skit](skills/skit/SKILL.md) | `execution` | 安装、检查、导出；装完验什么 |
| [skill-experiments](skills/skill-experiments/SKILL.md) | `process` | 用同题对照证明 skill 真的改变了产出，并迭代到有效 |

`skill-atlas` 定义标准，`skill-writing` 按标准写，`make-skill` 管步骤与关口，`skit` 管动作。

## 结构

| 路径 | 是什么 | 读者 |
|---|---|---|
| `THEORY.md` | 内容坐标：面 | 写 skill 的人、审 skill 的 agent |
| `docs/placement-audit.md` | 归位审计：现有材料能否被三个面放下 | 维护理论的人 |
| `docs/status.md` | 证据与限制：现在能说多少，哪些预测可被推翻 | 维护理论的人 |
| `docs/method.md` | 从选题到 loadout 的制作方法：选题、材料、实验、迭代、收敛 | 要做下一个 skill 的人 |
| `AGENTS.md` | 本仓库的常驻约定 | 任何在本仓库工作的 agent |
| `skills/skill-atlas/` | 坐标与标准 | 安装者 |
| `skills/skill-writing/` | 写一份 skill | 安装者 |
| `skills/make-skill/` | 制作流程 | 安装者 |
| `skills/skit/` | 安装与验证命令 | 安装者 |
| `skills/skill-experiments/` | 同题对照与迭代 | 安装者 |

## 为什么是这种形状

把一组 skill 想成插卡：每个技能是一张独立的卡，不认别的卡；一个任务需要几张就插几张，换任务就换一组。

这个类比只在一点上有用——插卡改变的是上下文，不是能力本身。所以插错卡（误触发）和插对卡一样容易发生，而"插上就会"是错觉。

由此有三条硬约束：

- 卡带彼此独立：不引用、不依赖顺序，否则换一张就得换全部；
- 每张卡只回答一个问题：否则两张卡会抢同一段指令；
- 卡面写清何时插：没有操作员替你挑卡，`description` 是唯一的操作员。

## 它的位置

- 判断透镜：给人（和 agent）判断 skill 站在哪、能不能换。
- 装在哪、谁可见：由 Skill 规范与宿主决定。
- 一组 skill（一个 `loadout`）怎么用：由使用者决定。

类比只是解释，不进入命名：skill 的名字按任务取，按 `description` 被匹配；带典故的名字只会让每次阅读多一层解码。

## 许可

MIT
