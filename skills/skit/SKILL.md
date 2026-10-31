---
name: skit
description: >
  Use when installing, updating, listing, checking, or exporting skills with the
  skit CLI, when deciding which source form to install from, or when writing
  path references for bundled scripts. Covers where skills are stored, how they
  reach agent directories, and what skit does and does not validate. Not for
  writing a skill or deciding when to publish one.
face: execution
scope: subject
license: MIT
metadata:
  author: vlln
  version: "2.0.0"
---

# skit：装、查、导出

skit 是一个 skill 管理器。它把技能收进一个本地存储，再用符号链接放进各个 agent 的技能目录。

**以装好的 `skit` 为准。** 下面的命令与行为核对于 2026-10-19（`skit` 0.9.x 与当时源码）；`skit help` 是最终权威，版本升级后重核。

## 事实：它怎么工作

- 技能存在本地 store（`~/.local/share/skit/skills/<name>`），清单是 `~/.local/share/skit/manifest.json`；agent 目录里放的是**符号链接**，不是副本。
- 安装是**复制来源**，不是运行；skit 不记录内容哈希。
- **`install` 只警告，不拒绝**：name 不合法、描述缺失、字段超长都会装进去，只打印 warning。
- 校验分三种强度，别混用：`install` 顺带警告；`validate` 查内容；`check` 只查安装状态（是否就位、版本是否落后）。
- 它不会替你判断技能写得好不好，也不会查触发是否准确。

## 常用动作

```sh
skit install <source>          # 装一个技能
skit list                      # 看装了哪些（--json 给机器读）
skit validate <path>           # 查内容（frontmatter、必填项）
skit check                     # 查安装状态与版本落后
skit outdated                  # 看哪些可以更新
skit export <name>             # 导出到指定目录
```

来源形式常见三种：

| 形式 | 例子 | 用途 |
|---|---|---|
| 仓库路径 | `owner/repo/skills/<name>` | 日常安装 |
| 目录 URL | `https://github.com/owner/repo/tree/main/skills/<name>` | README 里给人点 |
| 本地目录 | `./skills/<name>` | 开发时直装，CI 干净路径 |

两个容易误解的参数：`--name` 只改本地安装名，不改仓库里的 `name`；`--dir` 指定安装到某个干净目录，用于验证"别人真能装上"。

## 装完要验什么

1. 目标 agent 目录里出现链接，且指向 store 里的预期目录。
2. 装进去的技能**恰好**是你想装的那些，没有把同仓其它技能一起带进来。
3. 全程没有 warning；有 warning 就按内容问题先修，别把警告当成功。
4. 发布前在干净环境照 README 走一遍：只有 README 的指令，能装成。

## 引用包内文件：`$_S`

文档里写 `$_S/scripts/run.sh`，不写裸相对路径——agent 的工作目录不一定是技能目录。

`$_S` 是**文档占位符**，不是预置环境变量。实际执行时先定成绝对路径再用：

```sh
export _S="/absolute/path/to/skill"; $_S/scripts/run.sh
```

`_S`（不带美元符）才是变量名；正文里第一次出现时说明这一点，之后可直接引用。

## 不负责

技能写得对不对、触发准不准 → 质量面；该不该做、什么时候发版 → 流程面。本文只给动作与验证，不给判断标准。
