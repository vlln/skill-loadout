# dsh-loadout：历史设计（v1–v3）

> 下文保留历史设计依据。现行实现契约见 [会话优先的编组模型](session-first-design.md)；旧的整组启停、作用域默认、手动引用与守门人模式不再作为新模型的加载规则。

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

---

# v2：守门人模式（gatekeeper）——默认不加载

2026-11-02，用户定的语义，实现者照此执行。

## 核心语义

技能目录（发现根里的文件）只是**物理存放**，不代表逻辑加载。装了本插件，session 不再按标准发现逻辑加载全部技能——只有两类生效：

1. 当前 scope 的 activeLoadout 的成员（按编组配置加载）；
2. 被显式启用的单个技能（手动引用 = 现有的 enabledSkills override）。

## 机制（只动一个决策点）

所有改动集中在 `effectiveSkillPolicy`（core.ts）与其调用方，外加状态与 UI：

- `ManagerState` 增加 `gatekeeper?: boolean`（默认 true——装了本插件就是这个语义；设置里可关，关了就完全回到 v1 行为）。
- 解析当前 scope 的 activeLoadout：`resolveActiveLoadout(state, scopeKey)`；scopeKey 取法沿用 v1（user / project:<identity>）。
- `effectiveSkillPolicy` 的判定顺序改为：
  1. `override === false`（手动排除）→ 禁用；
  2. `override === true`（手动引用）→ 启用；
  3. gatekeeper 开 → 成员才启用，其余禁用；
  4. gatekeeper 关 → 现状（默认启用）。
  不可写状态、来源停用、不可加载（loadable=false）这些原有的硬条件照旧优先。
- `listProviderCandidates` 走 `effectiveSkillPolicy`，所以守门人自动对宿主生效——宿主侧与 agent 侧的覆盖发布逻辑一行不用改。

## 行为变化点

- gatekeeper 开且无 activeLoadout：**什么都不加载**（这是语义本身，不是 bug）。UI 在编组页签顶部给引导条："守门人已开启，当前没有启用的编组——新建或选一个。"
- gatekeeper 开时的 `applyLoadout(id, {exclusive})`：语义简化为"把它设为当前 scope 的 activeLoadout"。组外技能因为不是成员自动失效，**不需要**逐个写 disabled 列表；已有的 disabled override 保留（那是手动排除）。非排他应用 = 设为当前 + 不碰别的。
- gatekeeper 开时技能行的单开关语义变为"手动引用 / 取消引用"（写/清 enabledSkills override），UI 文案照此调整。
- 编组卡片加"当前"标记（它就是该 scope 的 activeLoadout 时）；应用按钮即"设为当前"。

## UI

- 设置里加开关：「守门人模式」默认开；说明文案一句："开启后，只有当前编组的成员与被手动引用的技能会加载。"
- 编组页签：当前编组标记、引导条、设为当前。
- 技能列表（既有页签）：守门人开时，非成员技能显示为"未加载"而不是"停用"，开关含义是"引用"。

## 测试

扩充 `test/loadout.test.mjs`：gatekeeper 默认开、成员加载/非成员不加载、手动引用覆盖基线、手动排除优先于成员资格、无 activeLoadout 时全不加载、gatekeeper 关闭后完全回到 v1 行为、换 scope 互不影响。全绿；既有可过测试集合不退化。

## 完成定义

同 v1，外加：假数据驱动 `effectiveSkillPolicy` 的断言逐条对应上面的判定顺序。

---

# v3：会话级编组控制 + composer 可见性

2026-11-02，用户定的体验方向：控制权放在对话里，可替换、可观察。

## 概念

- **会话级选择**：每个 session 可以选一个自己的编组（或"不加载"），覆盖 scope 默认。
- **可观察**：会话里有一个常驻控件，点开能看见当前编组与生效的技能名清单。
- 生效顺序：`sessionLoadouts[sessionId]` → `activeLoadout[scopeKey]` → 空（什么都不加载）。

## 机制

1. 状态：`ManagerState.sessionLoadouts?: Record<sessionId, loadoutId>`，校验照 loadouts 的写法（sessionId 非法/编组不存在 → 视为未选）。
2. `effectiveSkillPolicy` 增加 session 上下文：调用方传入 sessionId（agent-scoped provider 用 `agent.id`——运行时 `Agent.id` 就是 SessionId；`state()` 用请求头里的会话）。
3. agent-scoped provider 的 `listProviderCandidates` 要带上 sessionId（`options.sessionId`）。
4. 新路由：
   - `GET /session-loadout?sessionId=...` → `{ sessionId, loadoutId, effective: {source: "session"|"scope"|"none", loadout, skills: [names] } }`
   - `POST /session-loadout` `{ sessionId, loadoutId|null }` → 写覆盖（null = 显式"不加载"用空字符串？用 `loadoutId: ""` 表示显式空；缺省字段 = 回落 scope）。写后 afterWrite 失效 provider + 菜单缓存。

## composer 控件（client half）

- 注册到 `conversation.input.dock`：`ctx.slots.register({ name: "conversation.input.dock", id: "loadout", order: 30, locale: NS, inject: (sessionId) => ... })`——`inject` 收到 sessionId 是本功能的立足点（对照官方 queue dock 的写法）。
- 收起态：`<button>` 显示 `编组 · <名>` 或 `未加载编组`；带当前技能数。
- 展开：自绘 popover（用宿主 Button/Tag 原语），内容三块：编组单选列表（含「不加载」）、当前生效技能名清单（最多 8 行，超出显示"还有 N 张"）、「在插件里管理」按钮（打开插件页）。
- 切换调用 `POST /session-loadout`，成功后重新拉 `GET /session-loadout`。

## 测试

- core：session 覆盖优先于 scope；未选回落 scope；显式空则不加载；非法 sessionId/编组 id 视为未选；切换后 effective 变化。
- 路由：GET 形状、POST 变更头校验（负控 403）。
- provider：带 sessionId 时按会话判定（非成员不发布候选）。
- 客户端：控件渲染文案（有编组/未加载两种）、popover 列表项。

## 完成定义

`pnpm build`、`tsc --noEmit`、`check-committed-lib`、loadout 测试全绿；既有可过测试不退化；隔离实例里用两个 session 验证互不影响。
