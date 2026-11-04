# 仅使用宿主原生技能目录

## 设计

Loadout 不再注册 loadout:configuration，也不额外注入编组名称、成员、排除规则及生效名单。编组和排除是插件状态/UI 的职责，最终可用技能由会话 provider 提供。模型可见名单和说明由 DSH 原生 skill catalog 负责。

变更继续调用已注册 provider 的 control.invalidate，并通知宿主命令/前端目录缓存失效。不修改宿主 runtime-context 机制、不自动恢复冷会话、不向历史追加一份替代名单。

## 更新边界

- 已安装宿主的技能目录在 agent/pre-step 读取技能快照，不为 loadout 新增 agent/request 钩子。
- 变更在后续 pre-step 且发现结果完整时反映到原生 catalog。已进入的请求不会被追溯修改，同一步溢出重试也不能声称一定重取配置。
- 注册表处于不完整发现状态时，原生目录可能暂缓发布。压缩后的目录重建仍由宿主可见历史/摘要判断。
- 历史已加载技能说明不会被删除；真实技能调用可用性仍由当前会话 provider 校验。

## 实现与验证

移除额外上下文源模块与发布产物，保留 workingDirectory 供当前会话目录解析。干净打包检查明确禁止旧 loadout-context 产物。测试使用真实宿主 SkillRegistry 与原生技能插件 hooks，而不是再测试被删除的快照注入逻辑。

固定端口 56372 使用既有私有 HOME/DSH_HOME，技能和测试选择保留；没有修改宿主包或真实用户配置。
