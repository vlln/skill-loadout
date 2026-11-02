<p align="center">
  <img src="docs/assets/hero.png" alt="skill-loadout：一叠半透明的技能卡片，一张正在发着微光入槽" width="100%">
</p>

<h1 align="center">skill-loadout</h1>

<p align="center"><b>帮你把一堆 skill 整理成一次任务用得上的一组。</b></p>

<p align="center">
  <a href="#它给你什么">它给你什么</a> ·
  <a href="#安装">安装</a> ·
  <a href="#为什么这样分">为什么这样分</a>
</p>

<p align="center">
  <a href="https://agentskills.io"><img alt="Agent Skills" src="https://img.shields.io/badge/Agent_Skills-规范-4D6BFE?style=flat-square"></a>
</p>

<br>

## 装了太多 skill 会怎样

用一段时间以后大概会碰到这些：

- 每个会话都要加载全部 skill 的描述，装得越多，上下文越挤
- 说不清这个会话到底加载了哪几份
- 两份 skill 的触发条件写得像，不知道该用哪个
- 想换个用法（比如从写代码切到写文档），只能一个个点开关

这多半不是哪份 skill 写得不好，而是装的东西多了以后没有人管。

## 它给你什么

两块东西：五份 skill，和一个插件。

**五份 skill 帮你写 skill。** 写出来的 skill 每份只管一件事，彼此不引用，描述写得能被正确触发，一组之间不会抢同一段指令。

| skill | face | domain | 介绍 |
|---|---|---|---|
| [skill-atlas](skills/skill-atlas/SKILL.md) | `quality` | skills | 判断一份 skill 该管什么，两份是否重叠，要不要拆 |
| [skill-writing](skills/skill-writing/SKILL.md) | `quality` | skills | 一份 skill 写成什么样算合格 |
| [skill-making](skills/skill-making/SKILL.md) | `process` | skills | 从决定做到发布的流程和检查点 |
| [skit](skills/skit/SKILL.md) | `execution` | skills | 安装、检查、导出、装上以后怎么验 |
| [improvement-loop](skills/improvement-loop/SKILL.md) | `process` | skills | 改了好几版以后，怎么证明新版本更好 |

一般用法：手上有一堆材料要做成 skill，先用 `skill-atlas` 看每份该管什么、会不会和别的重叠；用 `skill-writing` 写；用 `skill-making` 走流程；写完用 `skit` 装上验一遍；以后要改，用 `improvement-loop` 对比新旧版本。

**一个插件帮你用 skill。** 装了以后不再默认加载全部，只加载你选中的那组。会话输入框上有个控件，随时能看到当前加载了哪些，也能换一组。

```sh
dsh plugin --profile web add "https://github.com/vlln/skill-loadout.git#path:/plugin"
```

插件的细节在 [plugin/README.md](plugin/README.md)。

## 安装

用 skit：

```sh
skit install vlln/skill-loadout/skills/skill-atlas vlln/skill-loadout/skills/skill-writing      # 定位与合格线
skit install vlln/skill-loadout/skills/skill-making vlln/skill-loadout/skills/improvement-loop  # 流程与改进回路
skit install vlln/skill-loadout/skills/skit                                    # 安装与校验命令
skit check
```

也可以用 npx skills（需要 Node.js 22.20 以上）：

```sh
npx skills add vlln/skill-loadout --skill skill-writing    # 换成别的名字就装别的
```

什么都没装的话，把下面这段发给 agent，让它自己装：

```text
Run `npx skills use "vlln/skill-loadout@skill-writing"` and follow the generated skill instructions now. Read its complete output, redirecting it to a temporary file first if necessary. Resolve relative paths from the supporting-files directory it provides.
```

本地改的时候，克隆下来用 `./skills/<名>` 装。五份互不引用，单独装一份也能用。

装完 `skit list` 里能看到这几份，`skit check` 没有指向它们的报错，就算装好了。

## 为什么这样分

回到开头那些问题。我们的做法是把 skill 当成一张张独立的卡：

- 一张卡只管一件事，否则两张卡会抢同一段指令
- 卡和卡之间不引用、不依赖顺序，否则换一张就得换全部
- 卡面写清什么时候该用，因为没人替你挑卡，`description` 是唯一的依据

按"这份 skill 回答什么问题"分，只有三种：流程（什么时候做什么、谁决定）、质量（什么样算合格）、执行（具体怎么做）。这就是表里的 face 一列。

还有一个后果：一个任务通常要好几份卡，这一组就是 loadout。卡多到一定程度以后，默认全加载是不行的，所以需要按组控制，也就是上面那个插件。

完整的论证、证据强度和可以被推翻的预测在 [THEORY.md](THEORY.md) 和 [docs/status.md](docs/status.md)。这套方法是做出来的，不是想出来的：[sw-dev-loadout](https://github.com/vlln/sw-dev-loadout)（8 份 skill）是它的产出，也是实验样本。

## 结构

| 路径 | 是什么 |
|---|---|
| `THEORY.md` | 按"回答什么问题"把 skill 分成三个面 |
| `skills/` | 五份 skill |
| `plugin/` | dsh-loadout 插件：按编组启用、配置、管理 skill |
| `docs/status.md` | 每条结论有多少证据，哪些预测还没测过 |
| `docs/method.md` | 从选题到做出 loadout 的过程 |
| `docs/archive/` | 早期模型下的归位审计，留作记录 |
| `AGENTS.md` | 本仓库的约定 |

## 许可

MIT
