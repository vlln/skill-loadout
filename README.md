# skill-atlas

用两个坐标给 skill 的内容定位：**它回答哪个问题**（面），**它在讲什么东西**（作用域）。

在这套坐标上，一个任务需要的 skill 可以按面配齐、按格替换，而已经存在的 skill 可以被归位、比较、判断是否重叠。

## 当前状态

**理论已定骨架，开始验证。** [THEORY.md](THEORY.md) 是唯一权威；[docs/placement-audit.md](docs/placement-audit.md) 是对 23 份真实 skill 的归位审计，也是这套坐标第一次被现实检验。

已创建四份 skill，覆盖三个面：

| 技能 | face | scope | 管什么 |
|---|---|---|---|
| [skill-atlas](skills/skill-atlas/SKILL.md) | `quality` | `method` | 用坐标给 skill 定位、判重叠、拆分、配组 |
| [make-skill](skills/make-skill/SKILL.md) | `quality` | `subject` | 写一份 skill 的合格线与写法；事实带日期 |
| [skill-lifecycle](skills/skill-lifecycle/SKILL.md) | `process` | `method` | 要不要做、怎么拆、何时升版本与发布、谁批准 |
| [skit](skills/skit/SKILL.md) | `execution` | `subject` | 装卸查询的命令、验证装成功、`$_S` 引用 |

## 结构

| 路径 | 是什么 | 读者 |
|---|---|---|
| `THEORY.md` | 内容坐标：面与作用域 | 写 skill 的人、审 skill 的 agent |
| `docs/placement-audit.md` | 归位审计：现有材料能否被三个面放下 | 维护理论的人 |
| `AGENTS.md` | 本仓库的常驻约定 | 任何在本仓库工作的 agent |
| `skills/skill-atlas/` | 内容定位 | 安装者 |
| `skills/make-skill/` | 写一份 skill | 安装者 |
| `skills/skill-lifecycle/` | 生命周期与授权 | 安装者 |
| `skills/skit/` | 安装与验证命令 | 安装者 |

## 这套东西不是什么

- 不是格式规范：不设必填字段，不做校验脚本。
- 不规定覆盖层级：装在哪、谁可见，由 Skill 规范与宿主决定。
- 不规定流程：组合是坐标的结果，不是它的要求。

## 许可

MIT
