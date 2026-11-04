# 多编组与技能库分层验证

2026-11-03 实测，dsh 0.2.1-rc.5、Node 22.23.1、macOS、Chrome headless；独立 HOME/DSH_HOME，合成技能，不使用模型凭据。

## 已验证

- 完整 `TMPDIR=/private/tmp npm test` 通过，新增 multi-loadout 回归进入正式测试命令。
- 旧 string 会话选择只读兼容数组；GET 不写迁移，新写入使用去重数组。
- API 对非法组、非法元素、同时出现单数/复数参数整次拒绝，无部分保存。
- L1={alpha,beta}、L2={beta,gamma}：实际宿主目录给三项，beta 诊断带两个贡献组。
- 取消 L1 后 beta/gamma 保留；删除 L1 不删除 L2；其他会话独立。
- 组成员同名冲突、缺失、无效与实际 provider 一致；单数兼容字段在多选时为 null。
- 浏览器连续勾选多个组菜单不关闭，两个勾选标记同时显示；数量是去重技能数，各组有独立编辑入口。
- 技能库分层：本地 Skills / 安装 Skills，本地内全局级 / 项目级，回收站为次级操作。
- 浏览器导入技能成功后回到本地库存，搜索能找到；建组候选包含该技能，不自动选入会话。
- 创建并用于会话追加新组，失败重试复用已经创建的 id；前端测试覆盖保留其他组。
- 仓库目录自己的对话框替换管理外壳，避免竞争的嵌套 portal。

## 宿主冷会话目录限制

发现且未用侵入方式绕过：宿主重启后，未激活历史会话的 `skills/list` 使用共享 preset scope，没有把 sessionId 传给 provider，可能返回全部原生库存。插件自己的会话并集视图正确，已激活 Agent 的目录和实际调用按编组约束。

已安装运行时证据（dsh 0.2.1-rc.5）：

- `@deepseek-ai/dsh-api-session-controller/lib/types/skill-catalog.js` 91、152–162：冷目录不激活 Agent，使用 preset scope；registry.list 只有 cwd/scope。
- 同包 `lib/types/agent.js` 174–179、198–220：支持的 agent lookup 会恢复会话。
- `@deepseek-ai/dsh-agent-loop/lib/index.js` 1985–2012：恢复以 write 打开持久化并可能追加中断闭合记录，随后触发生命周期。

因此插件不为修正目录显示而自动恢复会话，也不全局替换宿主服务。验证分别记录：冷会话目录不一致；通过公开 session/create 创建的活动会话并集/取消/删除/清空/跨会话隔离全部通过。

## 其他边界

- 跨浏览器同时改同一会话选择仍是最后写入覆盖；无服务端版本冲突检查。
- 安装与未安装来源的边界由库存接口保证；远程搜索结果不可直接作为组成员。
- 不修改真实配置、不自动发布；用户体验仍需人工验收。
