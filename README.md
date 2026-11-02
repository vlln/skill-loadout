<p align="center">
  <img src="docs/assets/hero.png" alt="skill-loadout：一叠半透明的技能卡片，一张正在发着微光入槽" width="100%">
</p>

<h1 align="center">skill-loadout</h1>

<p align="center"><b>帮你把一堆 skill 整理成：一次任务真正要用的那一组。</b></p>

<p align="center">
  <a href="#它给你什么">它给你什么</a> ·
  <a href="#安装">安装</a> ·
  <a href="#为什么这样分">为什么这样分</a>
</p>

<p align="center">
  <a href="https://agentskills.io"><img alt="Agent Skills" src="https://img.shields.io/badge/Agent_Skills-规范-4D6BFE?style=flat-square"></a>
</p>

<br>

## 先说个你大概遇到过的情况

skill 越装越多，然后开始不对劲：

- 每个会话都把**全部** skill 的描述塞进上下文，装的越多越吵；
- 你其实说不清这个会话到底加载了哪几份、生效的是哪些；
- 两份 skill 的触发描述互相重叠，命中谁靠运气；
- 想换一套（比如从"写代码"切到"写文档"）只能挨个点开关。

这通常不是哪份 skill 写得差，而是"一堆各自为战的 skill"这个形态到了数量上限。

## 它给你什么

两条路，一条做 skill，一条用 skill。

**做**：五份 skill 帮你产出**符合 loadout 理念的 skill**——每份只回答一个问题、彼此独立不互相引用、描述写得能被正确触发、一组之间不抢同一段权威。

| skill | face | domain | 介绍 |
|---|---|---|---|
| [skill-atlas](skills/skill-atlas/SKILL.md) | `quality` | skills | 定位、判重叠、拆分、配组 |
| [skill-writing](skills/skill-writing/SKILL.md) | `quality` | skills | 一份 skill 的合格线与写法 |
| [skill-making](skills/skill-making/SKILL.md) | `process` | skills | 做一份或一组 skill 的流程与关口 |
| [skit](skills/skit/SKILL.md) | `execution` | skills | 安装、检查、导出与验收 |
| [improvement-loop](skills/improvement-loop/SKILL.md) | `process` | skills | 多轮改进怎么证明 |

典型用法：拿一堆材料要做 skill，先用 `skill-atlas` 判断每份该回答哪个问题、会不会和别的抢；用 `skill-writing` 写；`skill-making` 管从决定做到发布的流程；写完用 `skit` 装上验一遍；以后改版用 `improvement-loop` 证明改得更好了。

**用**：一个 dsh 插件把"一组 skill"变成可命名、可切换、可观察的编组。

```sh
dsh plugin --profile web add "https://github.com/vlln/skill-loadout.git#path:/plugin"
```

装上之后默认不再全量加载：会话只加载你选的那组编组，聊天框上有一个控件随时能看当前加载了什么、换一组。详见 [plugin/README.md](plugin/README.md)。

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

## 为什么这样分

回到开头那个混乱。我们的答案是把 skill 当成**插卡**：

- 每张卡只回答一个问题——否则两张卡会抢同一段指令；
- 卡与卡彼此独立，不引用也不依赖顺序——否则换一张就得换全部；
- 卡面写清什么时候插——没有操作员替你挑卡，`description` 是唯一的操作员。

按"它主要回答哪个问题"分，只有三个答案：**流程**（何时做、谁决定）、**质量**（凭什么算合格）、**执行**（具体怎么动手）。这就是每份 skill 的 `face`。

顺带两个直接后果：一个任务通常是**几份卡**而不是一份，这组卡就是 loadout；而一旦卡多到一定程度，"默认全加载"必然崩，所以需要一个按组控制的东西——就是上面那个插件。

完整论证、证据强度与可被推翻的预测在 [THEORY.md](THEORY.md) 与 [docs/status.md](docs/status.md)；这个方法是实跑出来的，产品仓库 [sw-dev-loadout](https://github.com/vlln/sw-dev-loadout)（8 份 skill）是它的产出，也是它的实验样本。

## 结构

| 路径 | 是什么 |
|---|---|
| `THEORY.md` | 内容坐标：按"回答哪个问题"分三面 |
| `skills/` | 五份 skill（见上表） |
| `plugin/` | dsh-loadout 插件：按 loadout 启用、配置、管理一组 skill |
| `docs/status.md` | 证据与限制：每条结论有多硬、哪些预测还没测过 |
| `docs/method.md` | 从选题到 loadout 的制作方法 |
| `docs/archive/` | 旧模型下的归位审计，留作坐标第一次被检验的记录 |
| `AGENTS.md` | 本仓库的常驻约定 |

## 许可

MIT
