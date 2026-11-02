# dsh-loadout：loadout 功能设计契约（给实现者）

你在这个仓库（fork 自 dsh-skills-manager 的 dsh 插件）里加一个新功能：**loadout**——命名的、跨来源的一组技能，能整组启用 / 停用 / 应用。先读这篇，再读代码里既有的 category 实现（它是最近的邻居，模式照抄它）。

## 概念与边界

- loadout 回答的问题是"这次任务带哪几张卡"：它是一组 `{root, name}` 技能引用加一个名字。
- 与既有"分类"（category）的关系：category 是单 root 内的组织位面；loadout 是跨 root 的、面向任务的编组。两者共存，不合并、不互相引用。
- loadout 只管启停策略（复用现有的本地策略机制 `applyPolicySkillEnabled`），不复制文件、不动源文件。
- 不做：loadout 的分享/导入导出、版本化、与 preset 的联动。这些以后再说。

## 状态模型（roots.json / ManagerState）

在 ManagerState 上加一个字段（读写、校验、迁移都照 categories 的写法）：

```json
"loadouts": [{ "id": "<8字节hex>", "name": "<≤24字符>", "note": "<可空，≤140字符>", "members": [{"root": "<rootKey>", "name": "<skillName>"}] }],
"activeLoadout": { "<scopeKey 或 \"user\">": "<loadoutId>" }
```

- 校验照 `validPolicyLists` 的样式写 `validLoadouts`：坏数据整段丢弃并记 warning，不让坏 loadout 拖死整个 state。
- 成员引用可能悬空（技能后来被删了）：读取时容忍，展示时标"缺失"，应用时跳过并计入 skipped。

## 核心操作（core.ts，全部返回普通结果对象，错误码点分小写，中文错误文案）

照 `createCategory` / `setCategoryEnabled` 的模式写：

1. `createLoadout(name, note?, members?)` / `renameLoadout(id, name)` / `deleteLoadout(id)` / `setLoadoutNote(id, note)`
2. `addToLoadout(id, root, name)` / `removeFromLoadout(id, root, name)`——加成员前验证技能存在（`resolveEntry`）。
3. `setLoadoutEnabled(id, enabled)`——对全部成员逐个 `applyPolicySkillEnabled`；不可加载的跳过并计入 skipped（照 setCategoryEnabled 的聚合写法）。
4. `applyLoadout(id, { exclusive })`——先停用"不在本 loadout 里的、当前被启用的技能"（仅当 exclusive），再启用全部成员；把 `activeLoadout[scope]` 记成它。返回 `{ applied, skipped, disabledOthers }`。
5. `currentLoadout(scope)` 读 activeLoadout。

scope 的取法照现有 ScopeOptions（user / project cwds）。

## 路由（api-base.ts / index.ts）

照 category 的路由写法注册：

- `GET /loadouts?scope=` → `{ loadouts, active }`
- `POST /loadout-create` `{ name, note?, members? }`
- `POST /loadout-rename` `{ id, name }` / `POST /loadout-note` `{ id, note }` / `POST /loadout-delete` `{ id }`
- `POST /loadout-add` `{ id, root, name }` / `POST /loadout-remove` `{ id, root, name }`
- `POST /loadout-toggle` `{ id, enabled }`
- `POST /loadout-apply` `{ id, exclusive }`

全部走既有的变更头校验与 mutation 通道，不开新口子。

## UI（client.ts）

在现有侧栏页的 tab 列里加一个 "Loadouts"（zh: 编组）页签：

- 列表：每个 loadout 一行卡片——名字、note、成员数（缺失数）、启用开关、应用按钮（带"排他"勾选）、展开成员列表（行内可加删）。
- 顶部一个"新建 loadout"按钮（对话框：名字 + 备注 + 从当前已启用的技能勾选成员）。
- 应用成功的反馈条照现有 `result` 条的写法：显示 applied / skipped / disabledOthers 三个数。
- 样式沿用 `dssm-` 前缀与现有控件，不引新组件库，不写死颜色（06-ui-style 的硬约定）。
- 文案进 DICT（zh + en），key 前缀 `loadout.`。

## 测试（test/）

加 `test/loadout.test.mjs`，至少覆盖：创建/改名/删除、成员增删、整组启停（含不可加载成员的 skipped）、排他应用（exclusive 停用组外技能）、成员悬空时的容忍、activeLoadout 记录。照 categories 测试的写法（临时目录造根、直接调 core 函数）。

## 完成定义

1. `pnpm build` 通过；新增测试全绿；fork 既有测试的通过集合不退化（基线矩阵见 /tmp/r5matrix.txt 的对比方法——你的改动不允许把 pristine 能过的测试弄挂）。
2. 不动既有功能的任何行为；所有新代码都在新函数/新路由/新 UI 页签里。
3. 不注册任何与 npm 自更新相关的东西（这个 fork 不上架 npm）。
