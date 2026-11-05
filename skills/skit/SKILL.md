---
name: skit
description: Skill management with the skit CLI. Use when installing, updating, validating, or exporting skills, or troubleshooting their installation.
license: MIT
metadata:
  face: execution
  domain: agent-skills
  author: vlln
  version: "2.1.0"
---

# skit：装、查、导出

skit 是一个 skill 管理器。它把技能收进一个本地存储，再用符号链接放进各个 agent 的技能目录。

**以装好的 `skit` 为准。** 下面的命令与行为核对于 2026-11-01（`skit 0.10.0-dev` 的 `skit help`）；版本升级后先跑 `skit help <命令>` 重核。

## 事实：它怎么工作

- 技能存在本地 store（`~/.local/share/skit/skills/<name>`），清单是 `~/.local/share/skit/manifest.json`；agent 目录里放的是**符号链接**，不是副本。
- 安装是**复制来源**，不是运行。
- **`install` 只警告，不拒绝**：name 不合法、描述缺失、字段超长都会装进去，只打印 warning。
- 三种校验各查一件事，别混用：
  - `validate`：内容。必填字段、name 与目录一致、字段上限、正文长度、相对链接（含 `references/`）、frontmatter 拼写。`--strict` 让 warning 也非零退出。
  - `check`：安装状态。清单里的条目在不在、active 链接是否指向它。
  - `outdated`：来源是否更新。本地来源比 `metadata.version`，Git 来源比记录的 commit；有落后时退出码 1。
- 它不会替你判断技能写得好不好，也不会查触发是否准确。

## 常用动作

```sh
skit install <source>              # 装；同仓多份时用 -s <name> 只选一份
skit install <source> --dry-run    # 先看会装什么
skit list                          # 看装了哪些；--all 连外部装的一起扫
skit validate ./skills --strict    # 查内容，warning 也算失败
skit check                         # 查安装状态与链接
skit outdated                      # 看哪些落后于来源
skit export [path]                 # 把本地清单写成可分享的文件，默认 ./skit.json
skit install ./skit.json           # 按清单重装
```

来源形式常见三种：

| 形式 | 例子 | 用途 |
|---|---|---|
| 仓库路径 | `owner/repo/skills/<name>` | 日常安装 |
| 目录 URL | `https://github.com/owner/repo/tree/main/skills/<name>` | README 里给人点 |
| 本地目录 | `./skills/<name>` | 开发时直装 |

两个容易误解的参数：`--name` 只改本地安装名，不改仓库里的 `name`；`--dir <目录>` 把技能复制进一个目录，不写清单、不建链接，用于 CI 或验证"别人真能装上"。

## 读懂 validate 的报错

- `broken-link` / `broken-reference-link` 指向一个反引号：正文行内代码里有形似 Markdown 链接或图片的片段，被当成了链接。把示例改成文字描述，或移进围栏代码块再验。
- 同名 skill：装之前先 `skit list --all`。不同目录里的同名 skill 由宿主按优先级择一，装上不代表生效。

## 装完要验什么

1. 目标 agent 目录里出现链接，且指向 store 里的预期目录；`skit check` 无该条目的报错。
2. 装进去的技能**恰好**是你想装的那些，没有把同仓其它技能一起带进来。
3. 全程没有 warning；有 warning 就按内容问题先修，别把警告当成功。
4. 发布前用 `--dir` 装进一个空目录，只照 README 的指令走一遍，能装成。

## 引用包内文件

按官方规范写相对 skill 根目录的路径（如 `scripts/run.sh`）。某些宿主会以当前工作目录解析相对路径而不是 skill 根；遇到这种宿主，在调用处先解析成绝对路径再执行，不要因此改写技能内的引用格式。
