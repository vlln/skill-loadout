<p align="center">
  <img src="docs/assets/hero.png" alt="skill-loadout：一叠半透明的技能卡片，一张正在发着微光入槽" width="100%">
</p>

<h1 align="center">skill-loadout</h1>

<p align="center"><b>用一个问题给 skill 的内容定位：它主要回答哪个问题。</b></p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="THEORY.md">理论</a> ·
  <a href="docs/status.md">证据</a>
</p>

<p align="center">
  <a href="https://agentskills.io"><img alt="Agent Skills" src="https://img.shields.io/badge/Agent_Skills-规范-4D6BFE?style=flat-square"></a>
</p>

<br>

## 它是什么

一个任务可能需要几份 skill，各回答不同的问题；已经存在的 skill 可以被归位、比较、判断是否重叠。

**用 `atlas` 定位，用 `loadout` 组装**：前者是判断与地图，后者是一个任务实际加载的那几份。项目名取后者——这个仓库产出的是"可组装的一组"，不是一个工具。

## 当前状态

**理论已定骨架，方法跑过五轮真实对照。** [THEORY.md](THEORY.md) 是唯一权威；[docs/status.md](docs/status.md) 写清每条结论的证据有多硬、哪些预测还没测过。

产品仓库 [sw-dev-loadout](https://github.com/vlln/sw-dev-loadout) 是这套方法的产出，也是它的证据：8 份 skill（7 份通用软件开发 + 1 份 README 写作，后者原是独立仓库，实验完成后整体并入）。夹具与每一轮的原始产出都随它入库。

五份 skill，覆盖三个面：

| skill | face | domain | 介绍 |
|---|---|---|---|
| [skill-atlas](skills/skill-atlas/SKILL.md) | `quality` | skills | 定位、判重叠、拆分、配组 |
| [skill-writing](skills/skill-writing/SKILL.md) | `quality` | skills | 一份 skill 的合格线与写法 |
| [skill-making](skills/skill-making/SKILL.md) | `process` | skills | 做一份或一组 skill 的流程与关口 |
| [skit](skills/skit/SKILL.md) | `execution` | skills | 安装、检查、导出与验收 |
| [improvement-loop](skills/improvement-loop/SKILL.md) | `process` | skills | 多轮改进怎么证明 |

`skill-atlas` 定位，`skill-writing` 给合格线，`skill-making` 管步骤与关口，`skit` 管动作，`improvement-loop` 管多轮改进怎么证明。

## 插件：dsh-loadout

loadout 这个概念落在 dsh 里的形态：侧栏插件，把"一组 skill"变成可命名、可整组启停、可排他应用的东西（启用这组、停用其余，换任务换一组）。基于 dsh-skills-manager 改造，装后发现、安装、更新、启停单个技能的能力也都在。

```sh
dsh plugin --profile web add "https://github.com/vlln/skill-loadout.git#path:/plugin"
```

详见 [plugin/README.md](plugin/README.md)。

## 安装

推荐 skit：

```sh
skit install vlln/skill-loadout/skills/skill-atlas vlln/skill-loadout/skills/skill-writing      # 定位与合格线
skit install vlln/skill-loadout/skills/skill-making vlln/skill-loadout/skills/improvement-loop  # 流程与改进回路
skit install vlln/skill-loadout/skills/skit                                    # 安装与校验命令
skit check
```

生态通用 CLI（需 Node.js ≥ 22.20）：

```sh
npx skills add vlln/skill-loadout --skill skill-writing    # 例；换 --skill 装别的
```

什么都没装时，把这段直接发给 agent，让它自己装自己用：

```text
Run `npx skills use "vlln/skill-loadout@skill-writing"` and follow the generated skill instructions now. Read its complete output, redirecting it to a temporary file first if necessary. Resolve relative paths from the supporting-files directory it provides.
```

本地开发时克隆后用 `./skills/<名>` 直装。五份互不引用，装一份也能用。

跑通的样子：`skit list` 里出现刚装的几份，且 `skit check` 没有指向它们的报错。

## 结构

| 路径 | 是什么 | 读者 |
|---|---|---|
| `THEORY.md` | 内容坐标：面 | 写 skill 的人、审 skill 的 agent |
| `docs/archive/` | 归档：旧模型下的归位审计，留作坐标第一次被检验的记录 | 维护理论的人 |
| `docs/status.md` | 证据与限制：现在能说多少、有多硬，哪些预测可被推翻 | 维护理论的人 |
| `docs/method.md` | 从选题到 loadout 的制作方法：选题、材料、实验、迭代、收敛 | 要做下一个 skill 的人 |
| `AGENTS.md` | 本仓库的常驻约定 | 任何在本仓库工作的 agent |
| `skills/skill-atlas/` | 坐标与标准 | 安装者 |
| `skills/skill-writing/` | 写一份 skill | 安装者 |
| `skills/skill-making/` | 制作流程 | 安装者 |
| `skills/skit/` | 安装与验证命令 | 安装者 |
| `skills/improvement-loop/` | 多轮改进与证明 | 安装者 |
| `plugin/` | dsh-loadout 插件：以 loadout（一组 skill）为单位启用、配置、管理 | 使用者 |

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
