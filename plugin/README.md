<h1 align="center">dsh-loadout</h1>

<p align="center"><b>以一组 skill 为单位启用、配置、管理——loadout 是给一次任务配好的一组技能。</b></p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#用起来什么样">用起来什么样</a> ·
  <a href="#兼容性">兼容性</a>
</p>

<p align="center">
  <a href="../LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/Apache--2.0-开源-111?style=flat-square"></a>
  <a href="https://github.com/vlln/skill-loadout"><img alt="skill-loadout" src="https://img.shields.io/badge/vlln-skill--loadout-111?style=flat-square&logo=github"></a>
</p>

<br>

## 它是什么

dsh 的侧栏插件。单个技能的安装、发现、启停它都做（这部分来自上游 dsh-skills-manager）；在此之上它多回答一个问题：**这次任务带哪几张卡**。

一个 loadout 是一个命名的编组：把几张技能卡编进去，一键整组启用、整组停用，或者"排他应用"——启用这组、停用其余，然后换任务时换一组。

## 为什么需要它

技能装多了以后，每个任务真正需要的只是其中几张。逐个开关是体力活，而且"上次那组到底有哪几张"没人记得。loadout 把这组固化成一个有名的东西：编一次，以后一个动作切换。

与相邻能力的区别：插件管理器（Plugins 页）管的是插件包装没装，loadout 管的是已装技能在当前任务里生不生效；"分类"是浏览时的组织位面，loadout 是执行时的编组位面。

两件结构性的事：日常面对的不再是技能清单而是几个编组（管理复杂度随任务类型数增长，不随技能数）；装与用被拆开，装只是入库，囤积不再有上下文代价。展开见 [docs/why-loadout.md](docs/why-loadout.md)。

## 安装

插件在 [vlln/skill-loadout](https://github.com/vlln/skill-loadout) 仓库的 `plugin/` 子目录，产物已入库，git 源一行装：

```sh
dsh plugin --profile web add "https://github.com/vlln/skill-loadout.git#path:/plugin"
```

装好后侧栏出现「Loadout」入口。

## 用起来什么样

侧栏插件页有五个页签，最后一个是「编组」：

- 新建编组：起名、写备注、从当前已启用的技能里勾选成员。
- 每个编组一张卡片：整组启停开关、"设为当前"、成员行内增删。
- 应用结果给出三个数：启用几张、跳过几张（缺失或不可加载）、停用几张组外。

**守门人模式（默认开）**：装了本插件，技能的物理存放与逻辑加载就解耦了——发现根里的文件不再自动生效，session 只加载两类技能：当前编组的成员，以及你手动引用的单张卡（技能行的开关在守门人模式下就是"引用"）。关掉它（设置里）就完全回到系统默认的全量加载。

技术细节：启停是**策略层**操作，源文件不动；编组数据存在 `$DSH_HOME/skills-manager/state.json`，换 DSH_HOME 互不影响。

## 已知限制

- 守门人开启且没有"当前编组"时，任何技能都不加载——这是语义本身。设置里可关。
- 排他应用按"当前生效策略"计算组外技能，不区分它们是谁启用的。
- 编组不随技能文件移动：技能被卸载后，成员标记为"缺失"，不会自动从编组里删。
- 桌面版与网页版不互通（装在哪个 profile 就管哪个）。

## 兼容性

| dsh 版本 | 状态 |
|---|---|
| `0.2.1-rc.5` | ✅ 已验证（2026-11-02，隔离实例：安装、建组、加成员、排他应用、整组启停、负控 403） |
| 其它版本 | ⚠️ 未验证——升级 dsh 后若侧栏入口消失或页签空白，多半是宿主服务名改了 |

## 插件管理

装/卸/启停用官方 CLI：`dsh plugin --profile web add|remove <包>`；已装插件在**侧边栏 Plugins 页**里查看与配置。

## 致谢与许可

基于 [MichengAI/dsh-skills-manager](https://github.com/MichengAI/dsh-skills-manager)（Apache-2.0）改造。本插件同样以 Apache-2.0 发布。
