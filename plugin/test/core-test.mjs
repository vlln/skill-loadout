import { peerRange as DSH_PEER_RANGE } from "../scripts/hosts.mjs";
// dsh-skills-manager core 单元测试（临时根；ZIP 用例复用生产依赖 fflate）
// 运行：node test/core-test.mjs

import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
  symlink,
  rename,
} from "node:fs/promises";
import fs from "node:fs/promises";
import { createServer, request } from "node:http";
import { basename, dirname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { zipSync, strToU8 } from "fflate";
import { SkillRegistry } from "@deepseek-ai/dsh-skill";

import {
  toKebab,
  parseSkillDoc,
  unquote,
  parseBoolValue,
  renameWithRetry,
  createLoadout,
  setSessionLoadout,
  setSessionSkillExclusions,
  sessionLoadoutView,
  setSkillEnabled,
  setSourceEnabled,
  deleteSkill,
  listTrash,
  restoreTrash,
  permanentlyDeleteTrash,
  importSkill,
  importUploadedSkill,
  createSkill,
  skillDetail,
  listProviderCandidates,
  getProviderSkill,
  scanEntries,
  state,
  resolveEntry,
  entryPath,
  userRoots,
  projectRoots,
  browseDirectories,
  managerStatePath,
  readManagerState,
} from "../lib/core.js";
import {
  activeSessionCwds,
  apply as applyHost,
  inject as hostInject,
  notifyChatCatalog,
  registerAgentSkillProviders,
} from "../lib/index.js";

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("✗ " + msg);
  }
}
function eq(actual, expected, msg) {
  ok(
    actual === expected,
    msg +
      " (got " +
      JSON.stringify(actual) +
      ", want " +
      JSON.stringify(expected) +
      ")",
  );
}

function requestJson(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode,
            payload: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function makeSkill(root, name, content) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content, "utf8");
  return dir;
}

const tmp = await mkdtemp(join(tmpdir(), "dssm-test-"));
const testUserHome = join(tmp, "home");
process.env.HOME = testUserHome;
process.env.USERPROFILE = testUserHome;
process.env.DSH_HOME = join(tmp, "dsh");
process.env.DSH_AGENTS_HOME = join(tmp, "agents");
process.env.DSH_CODEX_HOME = join(tmp, "codex");
process.env.DSH_CLAUDE_HOME = join(tmp, "claude");
process.env.DSH_GEMINI_HOME = join(tmp, "gemini");
process.env.DSH_OPENCODE_HOME = join(tmp, "opencode");
process.env.DSH_CURSOR_HOME = join(tmp, "cursor");
const dshRoot = join(process.env.DSH_HOME, "skills");
const agentsRoot = join(process.env.DSH_AGENTS_HOME, "skills");
const ccswitchRoot = join(testUserHome, ".cc-switch", "skills");
const codexRoot = join(process.env.DSH_CODEX_HOME, "skills");
const cursorRoot = join(process.env.DSH_CURSOR_HOME, "skills");
await mkdir(dshRoot, { recursive: true });
await mkdir(agentsRoot, { recursive: true });
await mkdir(ccswitchRoot, { recursive: true });
await mkdir(codexRoot, { recursive: true });
await mkdir(cursorRoot, { recursive: true });

const ccswitchDefinition = userRoots().find((root) => root.key === "ccswitch");
ok(
  ccswitchDefinition && ccswitchDefinition.path === ccswitchRoot,
  "userRoots exposes the fixed CC Switch Skills storage",
);
ok(
  ccswitchDefinition &&
    ccswitchDefinition.mutable === false &&
    ccswitchDefinition.toggleable === true,
  "CC Switch retains read-only inventory metadata and legacy capability flag",
);
eq(
  ccswitchDefinition && ccswitchDefinition.rank,
  500,
  "CC Switch source ranks after shared Agents and before app-specific roots",
);
const cursorDefinition = userRoots().find((root) => root.key === "cursor");
ok(
  cursorDefinition && cursorDefinition.path === cursorRoot,
  "userRoots exposes the configurable Cursor Skills storage",
);
ok(
  cursorDefinition &&
    cursorDefinition.mutable === false &&
    cursorDefinition.toggleable === true,
  "Cursor retains read-only inventory metadata and legacy capability flag",
);
eq(
  cursorDefinition && cursorDefinition.rank,
  userRoots().find(root => root.key === 'opencode').rank + 10,
  "Cursor source ranks after the existing app-specific roots",
);
const firstTierUserRoots = {
  copilot: join(testUserHome, ".copilot", "skills"),
  windsurf: join(testUserHome, ".codeium", "windsurf", "skills"),
  "windsurf-user": join(testUserHome, ".windsurf", "skills"),
  trae: join(testUserHome, ".trae", "skills"),
  "trae-cn": join(testUserHome, ".trae-cn", "skills"),
  openclaw: join(testUserHome, ".openclaw", "skills"),
  clawdbot: join(testUserHome, ".clawdbot", "skills"),
  roo: join(testUserHome, ".roo", "skills"),
  codebuddy: join(testUserHome, ".codebuddy", "skills"),
  workbuddy: join(testUserHome, ".workbuddy", "skills"),
  qoder: join(testUserHome, ".qoder", "skills"),
  "qoder-cn": join(testUserHome, ".qoder-cn", "skills"),
  lingma: join(testUserHome, ".lingma", "skills"),
  antigravity: join(testUserHome, ".gemini", "config", "skills"),
};
for (const [key, expected] of Object.entries(firstTierUserRoots)) {
  const definition = userRoots().find((root) => root.key === key);
  ok(
    definition &&
      definition.path === expected &&
      definition.mutable === false &&
      definition.toggleable === true,
    `userRoots exposes the read-only ${key} Skills storage`,
  );
}

process.env.DSH_ANTIGRAVITY_HOME = join(tmp, "custom-antigravity");
const customAntigravity = userRoots().find((root) => root.key === "antigravity");
ok(
  customAntigravity && customAntigravity.path === join(process.env.DSH_ANTIGRAVITY_HOME, "skills"),
  "DSH_ANTIGRAVITY_HOME overrides Google Antigravity global skills path",
);
delete process.env.DSH_ANTIGRAVITY_HOME;

// Linux 同样必须拒绝 Windows 保留设备名；Windows 无法创建这类来源，故仅在可创建的系统上做端到端断言。
if (process.platform !== "win32") {
  const reservedSourceRoot = join(tmp, "reserved-source");
  const reservedHome = join(tmp, "reserved-home");
  const reservedRoot = join(reservedHome, "skills");
  await mkdir(reservedSourceRoot, { recursive: true });
  const conSource = await makeSkill(
    reservedSourceRoot,
    "con",
    "---\nname: con\n---\nbody",
  );
  const nulSource = join(reservedSourceRoot, "nul.md");
  await writeFile(nulSource, "---\nname: nul\n---\nbody", "utf8");
  const linkTarget = join(reservedSourceRoot, "link-target.md");
  await writeFile(linkTarget, "---\nname: link-target\n---\nbody", "utf8");
  const linkSource = join(reservedSourceRoot, "linked-source.md");
  await symlink(linkTarget, linkSource);
  const nestedLinkSource = await makeSkill(
    reservedSourceRoot,
    "nested-link",
    "---\nname: nested-link\n---\nbody",
  );
  await symlink(linkTarget, join(nestedLinkSource, "linked-content.md"));
  const originalDshHome = process.env.DSH_HOME;
  process.env.DSH_HOME = reservedHome;
  try {
    for (const [source, name] of [
      [conSource, "con"],
      [nulSource, "nul"],
    ]) {
      const result = await importSkill(source, null);
      ok(result.ok === false, `import rejects reserved device name: ${name}`);
      eq(
        result.failed[0].code,
        "error.import.invalidName",
        `reserved device name carries invalidName: ${name}`,
      );
    }
    let targetCreated = true;
    try {
      await stat(reservedRoot);
    } catch {
      targetCreated = false;
    }
    ok(
      targetCreated === false,
      "reserved-name imports do not create the target root",
    );

    await makeSkill(reservedRoot, "con", "---\nname: con\n---\nbody");
    await writeFile(
      join(reservedRoot, "nul.md"),
      "---\nname: nul\n---\nbody",
      "utf8",
    );
    eq(
      (await scanEntries(reservedRoot)).entries.length,
      0,
      "scan hides entries that cannot be resolved safely",
    );
    const linkedSourceImport = await importSkill(linkSource, null);
    eq(
      linkedSourceImport.code,
      "error.source.symlink",
      "import rejects a symbolic-link source",
    );
    const nestedLinkImport = await importSkill(
      join(nestedLinkSource, "SKILL.md"),
      null,
    );
    eq(
      nestedLinkImport.failed[0].code,
      "error.source.symlink",
      "import rejects a source containing a symbolic link",
    );
    // 预检必须与实导同口径：嵌套链接与深度超限在 dry-run 阶段即拒绝，不能等用户确认覆盖后才失败。
    const nestedLinkDry = await importSkill(
      join(nestedLinkSource, "SKILL.md"),
      null,
      { dryRun: true },
    );
    ok(
      nestedLinkDry.ok === false,
      "dry-run rejects a source containing a nested symbolic link",
    );
    eq(
      nestedLinkDry.failed[0].code,
      "error.source.symlink",
      "nested-link dry-run carries the symlink code",
    );
    const mixedBatch = join(reservedSourceRoot, "mixed-batch");
    const taintedSkill = await makeSkill(
      mixedBatch,
      "tainted",
      "---\nname: tainted\n---\nbody",
    );
    await symlink(linkTarget, join(taintedSkill, "linked.md"));
    await writeFile(
      join(mixedBatch, "clean.md"),
      "---\nname: clean\n---\nbody",
      "utf8",
    );
    const mixedDry = await importSkill(mixedBatch, null, { dryRun: true });
    ok(
      mixedDry.ok !== false,
      "mixed dry-run still reports the clean candidate",
    );
    eq(
      mixedDry.pending.length,
      1,
      "mixed dry-run keeps only the clean candidate pending",
    );
    eq(
      mixedDry.failed[0].code,
      "error.source.symlink",
      "mixed dry-run fails the tainted candidate",
    );
  } finally {
    process.env.DSH_HOME = originalDshHome;
  }
}

// ── 客户端装配约束 ──
// 客户端 bundle 由宿主 AMD 加载，无法在零依赖测试中直接挂载；仅保留协议常量锚点。
const clientBundle = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);
const clientSource = await readFile(
  new URL("../src/client.ts", import.meta.url),
  "utf8",
);
ok(
  clientBundle.includes('id: "dsh-loadout"'),
  "client registers the scoped package module ID",
);
ok(
  clientSource.includes('"x-dsh-loadout": "1"'),
  "client sends the mutation request marker",
);
ok(
  clientSource.includes("PrimitiveModal") &&
    clientSource.includes("title: props.title") &&
    clientSource.includes("onClose: props.onClose"),
  "dialogs use host Modal primitive",
);
ok(
  clientSource.includes(
    ".dssm-modal-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px}",
  ),
  "dialog actions wrap instead of stretching the dialog",
);
ok(
  clientSource.includes(".dssm-modal{max-height:100%}") &&
    clientSource.includes(
      ".dssm-modal-content>div:last-child{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}",
    ) &&
    clientSource.includes('contentClassName: ["dssm-modal-content"'),
  "long dialogs scroll inside the host content slot while actions stay visible",
);
ok(
  clientSource.includes('placeholder: t("search.placeholder")'),
  "settings panel registers a skill search input",
);
const filterRow = clientSource.slice(clientSource.indexOf("var skillControls ="));
const classPosition = name => filterRow.search(new RegExp(`className\\s*:\\s*["']${name}["']`));
ok(
  classPosition("dssm-source-filter") >= 0 &&
    classPosition("dssm-source-filter") < classPosition("dssm-status-filter") &&
    classPosition("dssm-status-filter") < classPosition("dssm-search") &&
    classPosition("dssm-search") < classPosition("dssm-filter-actions"),
  "compact inventory toolbar keeps filters, search and maintenance actions together",
);
ok(
  clientSource.includes("SegmentedTabs") &&
    /className\s*:\s*["']dssm-inventory-section["']/.test(clientSource) &&
    clientSource.includes("globalRoots.map(root=>renderRoot(root)).filter(Boolean)") &&
    !clientSource.includes("renderSection(false),renderSection(true)"),
  "library renders only global inventory; project controls belong to the chat session",
);
ok(
  clientSource.includes('"root.ccswitch": "CC Switch"') &&
    clientSource.includes('"root.cursor": "Cursor"') &&
    clientSource.includes('"root.copilot": "GitHub Copilot"') &&
    clientSource.includes('"root.windsurf": "Windsurf"') &&
    clientSource.includes('"root.traeCn": "Trae CN"') &&
    clientSource.includes('"root.codebuddy": "CodeBuddy"') &&
    clientSource.includes('"root.workbuddy": "WorkBuddy"') &&
    clientSource.includes('"root.qoder": "Qoder"') &&
    clientSource.includes('"root.qoderCn": "Qoder CN CLI"') &&
    clientSource.includes('"root.lingma": "Qoder CN"'),
  "settings panel localizes the CC Switch, Copilot, Cursor, and first-tier Agent sources in both dictionaries",
);
ok(
  (await readFile(new URL("../src/source-select.ts", import.meta.url), "utf8")).includes('"aria-label": props.label'),
  "筛选器在独立组件中提供可访问标签",
);
ok(
  (await readFile(new URL("../src/source-select.ts", import.meta.url), "utf8")).includes("@deepseek-ai/dsh-client-ui-primitives"),
  "筛选下拉使用宿主官方原语 Menu",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
ok(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version),
  "发布包版本符合 SemVer",
);
ok(
  !packageJson.peerDependencies["@deepseek-ai/dsh-client-runtime"],
  "package does not install the retired client runtime peer",
);
ok(
  packageJson.peerDependencies["@deepseek-ai/dsh-client-ui-slots"],
  "package declares the settings slots peer",
);
ok(
  packageJson.peerDependencies["@deepseek-ai/dsh-host-webserver"] ===
    DSH_PEER_RANGE,
  "host-webserver peer only supports the tested versions",
);
ok(
  packageJson.peerDependencies["@deepseek-ai/dsh-skill"] === DSH_PEER_RANGE,
  "skill peer only supports the tested versions",
);
ok(
  packageJson.peerDependencies["@deepseek-ai/dsh-tools"] === DSH_PEER_RANGE,
  "tools peer only supports the tested versions",
);
ok(
  !packageJson.peerDependencies["@deepseek-ai/dsh-client-ui-workspace"],
  "browser-native import no longer depends on the workspace directory picker",
);
ok(
  clientSource.includes("inflightRef"),
  "client guards mutations with a synchronous in-flight flag",
);
ok(
  clientSource.includes("if (inflightRef.current) return Promise.reject"),
  "post rejects a second in-flight mutation synchronously",
);
ok(
  clientSource.includes("function submitImport()") &&
    clientSource.includes('post("/upload", Object.assign({}, payload, destinationPayload('),
  "upload import uses the shared guarded mutation path",
);
ok(
  clientSource.includes("function submitCreate()") &&
    clientSource.includes('post("/create", Object.assign({}, form,'),
  "create uses the shared guarded mutation path",
);
ok(
  clientSource.includes('webkitdirectory: ""'),
  "folder import uses the browser-native folder picker",
);
ok(
  !clientSource.includes('className: "dssm-modal-browser"'),
  "folder selection does not chain into a second custom picker",
);
ok(
  !clientSource.includes("ctx.workspaces.pickDirectory"),
  "folder picker never launches the Node-hosted workspace chooser",
);
const publishWorkflow = await readFile(
  new URL("../.github/workflows/publish.yml", import.meta.url),
  "utf8",
);
ok(
  publishWorkflow.includes("id-token: write"),
  "publish workflow enables OIDC trusted publishing",
);
ok(
  publishWorkflow.includes("pnpm install --frozen-lockfile"),
  "publish workflow installs the ZIP runtime dependency from the lockfile",
);
ok(
  !publishWorkflow.includes("registry-url:"),
  "publish workflow relies on package publishConfig instead of token-backed registry setup",
);
ok(
  publishWorkflow.includes("npm run verify"),
  "publish workflow runs the build, test, package, and generated-output checks",
);
ok(
  publishWorkflow.includes("npm publish"),
  "publish workflow publishes the package after tests",
);
const verificationWorkflow = await readFile(
  new URL("../.github/workflows/verify.yml", import.meta.url),
  "utf8",
).catch(() => "");
ok(
  verificationWorkflow.includes("pull_request:"),
  "verification workflow runs for pull requests",
);
ok(
  verificationWorkflow.includes("npm run verify"),
  "verification workflow enforces generated-output checks before merge",
);

// ── 命名规整 ──
eq(toKebab("FooBar"), "foo-bar", "toKebab camelCase");
eq(toKebab("Foo Bar_Test"), "foo-bar-test", "toKebab mixed separators");
eq(
  toKebab("guizang-ppt-skill-main"),
  "guizang-ppt-skill-main",
  "toKebab already kebab",
);
eq(
  toKebab("  GuiZangPPT-Skill  "),
  "gui-zang-ppt-skill",
  "toKebab trim + acronym-ish",
);
eq(toKebab("中文名"), "", "toKebab non-ascii strips to empty");
eq(toKebab("C盘清理顾问"), "", "toKebab non-ascii does not truncate to single ascii letters");
eq(toKebab("docx脚注图片字压字修复"), "", "toKebab non-ascii does not truncate to docx");
eq(toKebab("归藏网页PPT"), "", "toKebab non-ascii does not truncate to ppt");
eq(toKebab("MinerU解析整理"), "", "toKebab non-ascii does not truncate to miner-u");

// ── 前台目录浏览器：只列真实子目录，并返回可导航的绝对路径 ──
const browseRoot = join(tmp, "browse-root");
await mkdir(join(browseRoot, "zeta"), { recursive: true });
await mkdir(join(browseRoot, ".hidden"), { recursive: true });
await writeFile(join(browseRoot, "file.txt"), "not a directory", "utf8");
const browseResult = await browseDirectories(browseRoot);
ok(browseResult.ok !== false, "browseDirectories lists an absolute directory");
eq(
  browseResult.path,
  browseRoot,
  "browseDirectories returns the canonical current path",
);
eq(
  browseResult.entries.map((entry) => entry.name).join(","),
  ".hidden,zeta",
  "browseDirectories lists directories only and sorts them",
);
ok(
  browseResult.entries.find((entry) => entry.name === ".hidden").hidden,
  "browseDirectories marks dot directories hidden",
);
eq(
  (await browseDirectories("relative-folder")).code,
  "error.browse.absolute",
  "browseDirectories rejects relative paths",
);
const browseLinkedTarget = join(tmp, "browse-linked-target");
await mkdir(browseLinkedTarget, { recursive: true });
const browseLinkType = process.platform === "win32" ? "junction" : undefined;
if (
  await tryLink(
    browseLinkedTarget,
    join(browseRoot, "junction"),
    browseLinkType,
  )
) {
  ok(
    !(await browseDirectories(browseRoot)).entries.some(
      (entry) => entry.name === "junction",
    ),
    "browseDirectories excludes directory links and Windows junctions",
  );
} else {
  ok(
    true,
    "directory-link browser test skipped because this environment cannot create links",
  );
}
eq(entryPath(dshRoot, "foo:bar"), null, "entryPath rejects Windows ADS names");
eq(entryPath(dshRoot, ".hidden"), null, "entryPath rejects leading-dot names");
eq(
  entryPath(dshRoot, ".good-skill.dssm-stage-dead"),
  null,
  "entryPath rejects leftover stage directories",
);
eq(
  entryPath(dshRoot, "a".repeat(129)),
  null,
  "entryPath rejects names longer than 128 characters",
);
ok(
  entryPath(dshRoot, "a".repeat(128)) !== null,
  "entryPath accepts a 128-character name",
);

// ── frontmatter 解析 ──
const protoDoc = parseSkillDoc(
  "---\n__proto__: polluted\nname: proto\n---\nbody",
);
ok(
  Object.getPrototypeOf(protoDoc.map) === null,
  "frontmatter map uses a null prototype",
);
eq(protoDoc.map.name, "proto", "frontmatter still reads ordinary keys");
const bomDoc = parseSkillDoc("\uFEFF---\nname: foo\n---\nbody");
eq(bomDoc.map.name, "foo", "parseSkillDoc strips BOM");
eq(bomDoc.body, "body", "parseSkillDoc body");

const q = parseSkillDoc(
  '---\nname: foo\ndescription: "has: colon"\ndisable-model-invocation: true\n---\nhello',
);
eq(q.map.description, "has: colon", "parseSkillDoc reads quoted value");
eq(unquote(q.map.description), "has: colon", "unquote");
eq(parseBoolValue("true"), true, "parseBoolValue true");
eq(parseBoolValue("YES"), true, "parseBoolValue yes");
eq(parseBoolValue("off"), false, "parseBoolValue off");
eq(parseBoolValue("0"), false, "parseBoolValue 0");
eq(parseBoolValue("notabool"), undefined, "parseBoolValue invalid");

let transientRenameAttempts = 0;
await renameWithRetry("from", "to", {
  delayMs: 0,
  rename: async function () {
    transientRenameAttempts++;
    if (transientRenameAttempts < 3) {
      const error = new Error("temporary Windows lock");
      error.code = "EPERM";
      throw error;
    }
  },
});
eq(
  transientRenameAttempts,
  3,
  "renameWithRetry retries transient Windows EPERM errors",
);

let permanentRenameAttempts = 0;
let permanentRenameCode = "";
try {
  await renameWithRetry("from", "to", {
    delayMs: 0,
    rename: async function () {
      permanentRenameAttempts++;
      const error = new Error("invalid path");
      error.code = "EINVAL";
      throw error;
    },
  });
} catch (error) {
  permanentRenameCode = error.code;
}
eq(
  permanentRenameAttempts,
  1,
  "renameWithRetry does not retry permanent errors",
);
eq(permanentRenameCode, "EINVAL", "renameWithRetry preserves permanent errors");

const folded = parseSkillDoc(
  "---\nname: folded\ndescription: >-\n  First line.\n  Second line.\n---\nbody",
);
eq(
  folded.map.description,
  "First line. Second line.",
  "parseSkillDoc reads folded description",
);
const deeplyIndented = parseSkillDoc(
  "---\nname: indented\ndescription: |\n    First line.\n    Second line.\n---\nbody",
);
eq(
  deeplyIndented.map.description,
  "First line.\nSecond line.",
  "parseSkillDoc removes common block indentation",
);

// 显式缩进只剥离指定数量的空格，而不是内容的最小缩进。
for (const header of ["|2", "|2-", "|-2", "|2+", "|+2"]) {
  const explicitLiteral = parseSkillDoc(
    `---\ndescription: ${header}\n    First line.\n      Second line.\nname: explicit\n---\nbody`,
  );
  eq(
    explicitLiteral.map.description,
    "  First line.\n    Second line.",
    `parseSkillDoc honors explicit literal indentation: ${header}`,
  );
  eq(explicitLiteral.map.name, "explicit", `${header} stops at the next field`);
  eq(explicitLiteral.body, "body", `${header} preserves the body`);
  eq(explicitLiteral.fields[0].raw, header, `${header} preserves the raw header`);
}
for (const header of [">2", ">2-", ">-2", ">2+", ">+2"]) {
  const explicitFolded = parseSkillDoc(
    `---\ndescription: ${header}\n  First line.\n  Second line.\n---\nbody`,
  );
  eq(
    explicitFolded.map.description,
    "First line. Second line.",
    `parseSkillDoc retains folded display semantics: ${header}`,
  );
}
for (const indentation of [1, 9]) {
  const explicitBoundary = parseSkillDoc(
    `---\ndescription: |${indentation}\n${" ".repeat(indentation + 2)}First line.\n${" ".repeat(indentation + 4)}Second line.\n---\nbody`,
  );
  eq(
    explicitBoundary.map.description,
    "  First line.\n    Second line.",
    `parseSkillDoc supports indentation indicator ${indentation}`,
  );
}
const explicitSecondLine = parseSkillDoc(
  "---\ndescription: |2\n  First line.\n    Second line.\n---\nbody",
);
eq(
  explicitSecondLine.map.description,
  "First line.\n  Second line.",
  "parseSkillDoc preserves extra indentation on the second literal line",
);

// ── Explicit session selection; legacy policy APIs cannot write hidden policy ──
const policySession = "core-policy-session";
let fixtureNumber = 0;
async function selectMembers(members, options = {}, sessionId = policySession) {
  // Project skills are cwd defaults, never group members. This helper selects only global fixtures.
  const globalMembers = members.filter(member => !member.root.startsWith('project-'));
  const result = await createLoadout(`Core fixture ${++fixtureNumber}`, null, globalMembers, undefined, options);
  if (!result.loadout) throw new Error(`fixture creation failed: ${JSON.stringify(result)}`);
  const selected = await setSessionLoadout(sessionId, result.loadout.id);
  if (selected.ok === false) throw new Error(`fixture selection failed: ${JSON.stringify(selected)}`);
  return result.loadout;
}
const member = (root, name) => ({ root, name });
const selectedCandidates = (options = {}) => listProviderCandidates({ sessionId: policySession, ...options });
const selectedState = (options = {}) => state({ sessionId: policySession, ...options });
const goodSkillSource = "---\nname: good-skill\ndescription: A good skill.\n---\nbody";
await makeSkill(dshRoot, "good-skill", goodSkillSource);
eq((await state()).summary.enabled, 0, "installed inventory is not selected by default");
await selectMembers([member("dsh", "good-skill")]);
eq((await selectedState()).summary.enabled, 1, "explicit selection enables the valid member");
const audit = [];
eq((await setSkillEnabled(dshRoot, "good-skill", false, event => audit.push(event))).code, "error.policy.sessionOnly", "legacy disable is rejected");
eq((await setSkillEnabled(dshRoot, "good-skill", true, event => audit.push(event))).inventoryOnly, true, "install compatibility hook is inventory-only");
eq(audit.length, 0, "rejected/inert policy calls emit no policy audit");
eq(await readFile(join(dshRoot, "good-skill", "SKILL.md"), "utf8"), goodSkillSource, "session policy preserves source bytes");
for (const [name, text] of [
  ["crlf-skill", "---\r\nname: crlf-skill\r\ndescription: CRLF skill.\r\n---\r\nbody"],
  ["quoted-skill", '---\nname: quoted-skill\ndescription: "Quoted description: unchanged"\nmetadata:\n  source: retained\n---\nbody'],
  ["literal-skill", "---\nname: literal-skill\ndescription: |\n  disable-model-invocation: explanatory text\n  user-invocable: explanatory text\n---\nbody"],
  ["trailing-root", "---\nname: trailing-root\ndescription: Trailing root.\n---\nbody"],
]) {
  await makeSkill(dshRoot, name, text);
  await selectMembers([member("dsh", name)]);
  await setSessionLoadout(policySession, null);
  eq(await readFile(join(dshRoot, name, "SKILL.md"), "utf8"), text, `select/clear preserves ${name} source exactly`);
}
eq((await setSkillEnabled(dshRoot + sep, "trailing-root", false)).code, "error.policy.sessionOnly", "normalized paths do not revive legacy toggles");
const missing = await createLoadout("Missing member", null, [member("dsh", "no-such-skill")]);
eq(missing.ok, false, "new selections reject missing inventory members");
await makeSkill(dshRoot, "plain-skill", "没有 frontmatter 的正文");
await makeSkill(dshRoot, "missing-description", "---\nname: missing-description\n---\nbody");
await selectMembers([member("dsh", "plain-skill"), member("dsh", "missing-description")]);
const invalidMembers = (await sessionLoadoutView(policySession)).effective.members;
ok(invalidMembers.every(item => item.status === "invalid"), "selection cannot make structurally invalid members loadable");
eq((await sessionLoadoutView(policySession)).effective.skills.length, 0, "invalid members never enter effective skill list");
eq(await readFile(join(dshRoot, "plain-skill", "SKILL.md"), "utf8"), "没有 frontmatter 的正文", "missing frontmatter remains unchanged");
await makeSkill(dshRoot, "skill-scan", "---\nname: SkillScan\ndescription: Security gate for skills.\n---\nbody\n");
await selectMembers([member("dsh", "skill-scan")]);
eq((await sessionLoadoutView(policySession)).effective.skills[0], "skill-scan", "selected title-case declaration canonicalizes to kebab case");
for (const name of ["nested-title-scan", "team/nested-title-scan"]) {
  await makeSkill(codexRoot, name, "---\nname: NestedTitleScan\ndescription: 嵌套标题名回归。\n---\n正文\n");
}
await selectMembers([member("codex", "nested-title-scan"), member("codex", "team/nested-title-scan")]);
const nestedTitleSkills = (await selectedState()).roots.flatMap(root => root.skills || []).filter(skill => skill.declaredName === "NestedTitleScan");
eq(nestedTitleSkills.filter(skill => skill.winner).length, 1, "selected same-name nested copies produce one winner");
eq(nestedTitleSkills.find(skill => skill.winner)?.canonicalName, "nested-title-scan", "nesting does not change canonical name");
ok(nestedTitleSkills.some(skill => skill.shadowedBy?.name === "nested-title-scan"), "nested copy reports shadowing");
const nestedTitleCandidates = (await selectedCandidates()).filter(candidate => candidate.locator?.entryName?.includes("nested-title-scan"));
eq(nestedTitleCandidates.length, 1, "provider merges nested duplicate candidates");
ok(nestedTitleCandidates.every(candidate => candidate.name === "nested-title-scan"), "provider rejects uppercase invocation names");
for (const name of ["nested-title-scan", "team/nested-title-scan"]) await rm(join(codexRoot, name), { recursive: true });

// ── 中文技能与混排技能保真回归（Issue #53）──
await makeSkill(
  dshRoot,
  "国自然申请书自检",
  `---
name: 国自然申请书自检
description: 基金申请书自检规范。
---
自检正文
`,
);
await makeSkill(
  codexRoot,
  "C盘清理顾问",
  `---
name: C盘清理顾问
description: 清理C盘冗余文件。
---
清理正文
`,
);
await makeSkill(
  codexRoot,
  "D盘清理顾问",
  `---
name: D盘清理顾问
description: 清理D盘冗余文件。
---
清理正文
`,
);
await makeSkill(
  codexRoot,
  "docx脚注图片字压字修复",
  `---
name: docx脚注图片字压字修复
description: 修复Word排版压字问题。
---
修复正文
`,
);
await makeSkill(
  codexRoot,
  "归藏网页PPT",
  `---
name: 归藏网页PPT
description: 网页生成PPT排版。
---
PPT正文
`,
);

const issue53State = await state();
const allIssue53Skills = issue53State.roots.flatMap(root => root.skills || []);

const guoziranSkill = allIssue53Skills.find(s => s.name === "国自然申请书自检");
ok(guoziranSkill, "找到中文技能 国自然申请书自检");
eq(guoziranSkill.loadable, false, "宿主不接受的格式不允许启用（loadable === false）");
eq(guoziranSkill.diagnostics.length, 1, "中文技能带有格式诊断提示");
eq(guoziranSkill.diagnostics[0].code, "diagnostic.name.invalid", "中文技能诊断代码为 diagnostic.name.invalid");
eq(guoziranSkill.declaredName, "国自然申请书自检", "中文技能 declaredName 保留真实中文名");

await selectMembers([member("dsh", "国自然申请书自检")]);
eq((await sessionLoadoutView(policySession)).effective.members[0].status, "invalid", "selected Chinese invocation name remains invalid");
// Legacy references remain available for explicit migration, never silently cleaned by toggles.
const managerStateFile = managerStatePath();
const rawState = JSON.parse(await readFile(managerStateFile, "utf8"));
rawState.enabledSkills.dsh = ["国自然申请书自检", "broken-frontmatter-skill", "ghost-deleted-skill"];
await writeFile(managerStateFile, JSON.stringify(rawState, null, 2), "utf8");
await makeSkill(dshRoot, "broken-frontmatter-skill", "没有 frontmatter 的损坏技能");
const legacyBefore = await readFile(managerStateFile, "utf8");
for (const name of rawState.enabledSkills.dsh) {
  eq((await setSkillEnabled(dshRoot, name, false)).code, "error.policy.sessionOnly", `legacy disable rejected for ${name}`);
}
eq(await readFile(managerStateFile, "utf8"), legacyBefore, "rejected toggles preserve invalid and dangling legacy references");
eq((await state()).summary.enabled, 0, "legacy references do not load skills without session selection");

const cSkill = allIssue53Skills.find(s => s.name === "C盘清理顾问");
const dSkill = allIssue53Skills.find(s => s.name === "D盘清理顾问");
const docxSkill = allIssue53Skills.find(s => s.name === "docx脚注图片字压字修复");
const pptSkill = allIssue53Skills.find(s => s.name === "归藏网页PPT");

ok(cSkill && dSkill && docxSkill && pptSkill, "所有混排中文技能均正常发现");
eq(cSkill.loadable, false, "宿主不接受格式的混排技能不允许启用（loadable === false）");
eq(cSkill.declaredName, "C盘清理顾问", "C盘清理顾问 declaredName 不被截断为 c");
eq(dSkill.declaredName, "D盘清理顾问", "D盘清理顾问 declaredName 不被截断为 d");
eq(docxSkill.declaredName, "docx脚注图片字压字修复", "docx脚注图片字压字修复 declaredName 不被截断为 docx");
eq(pptSkill.declaredName, "归藏网页PPT", "归藏网页PPT declaredName 不被截断为 ppt");

ok(!cSkill.shadowedBy, "C盘清理顾问不被错误覆盖");
ok(!dSkill.shadowedBy, "D盘清理顾问不被 C盘清理顾问 覆盖");

// 中文目录但 frontmatter 声明合法英文名：宿主接受，允许启用
await makeSkill(
  codexRoot,
  "中文目录带英文声明",
  `---
name: chinese-dir-english-name
description: 中文目录但带有符合规范的英文调用标识。
---
正文
`,
);
const stateWithEnglishName = await state();
const englishNamedSkill = stateWithEnglishName.roots.flatMap(r => r.skills || []).find(s => s.name === "中文目录带英文声明");
ok(englishNamedSkill, "发现中文目录带英文声明的技能");
eq(englishNamedSkill.loadable, true, "带合法英文调用标识时允许启用（loadable === true）");
eq(englishNamedSkill.diagnostics.length, 0, "带合法英文标识不报 diagnostic.name.invalid");
eq(englishNamedSkill.canonicalName, "chinese-dir-english-name", "canonicalName 为合法英文标识");
await rm(join(codexRoot, "中文目录带英文声明"), { recursive: true });

const issue53Candidates = await listProviderCandidates();
const ghostNames = ["c", "d", "docx", "ppt", "miner-u", "mineru", "dj-vu"];
for (const ghost of ghostNames) {
  ok(!issue53Candidates.some(c => c.name === ghost), `provider 候选绝对不包含截断假条目: ${ghost}`);
}
ok(
  issue53Candidates.every(c => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.name)),
  "provider 上报给宿主的所有候选均必须满足宿主 ASCII kebab 契约，避免宿主崩溃",
);

await rm(join(dshRoot, "国自然申请书自检"), { recursive: true });
for (const name of ["C盘清理顾问", "D盘清理顾问", "docx脚注图片字压字修复", "归藏网页PPT"]) {
  await rm(join(codexRoot, name), { recursive: true });
}
await makeSkill(
  agentsRoot,
  "public-skill",
  "---\nname: public-skill\ndescription: Public skill.\n---\nbody",
);
eq((await setSkillEnabled(agentsRoot, "public-skill", false)).code, "error.policy.sessionOnly", "public Agent legacy toggle rejected");
const publicDoc = parseSkillDoc(await readFile(join(agentsRoot, "public-skill", "SKILL.md"), "utf8"));
ok(publicDoc.map["disable-model-invocation"] === undefined, "public skill metadata remains unchanged");
const sourceDisabledText = "---\nname: source-disabled\ndescription: Disabled in source.\ndisable-model-invocation: true\nuser-invocable: false\n---\nSource-disabled body";
await makeSkill(dshRoot, "source-disabled", sourceDisabledText);
const manualOnlyText = "---\nname: manual-only\ndescription: Only invoked by user.\ndisable-model-invocation: true\n---\nManual only body";
await makeSkill(dshRoot, "manual-only", manualOnlyText);
await selectMembers([member("dsh", "source-disabled"), member("dsh", "manual-only")]);
const sourceDisabledView = (await sessionLoadoutView(policySession)).effective.members.find(item => item.name === "source-disabled");
eq(sourceDisabledView.status, "invalid", "selection never overrides both source channels disabled");
let manualCandidate = (await selectedCandidates()).find(item => item.name === "manual-only");
ok(manualCandidate && !manualCandidate.invocation.modelInvocable && manualCandidate.invocation.userInvocable, "selected manual-only skill retains source restrictions");
await setSessionLoadout(policySession, null);
manualCandidate = (await selectedCandidates()).find(item => item.name === "manual-only");
ok(manualCandidate && !manualCandidate.invocation.modelInvocable && !manualCandidate.invocation.userInvocable, "cleared session blocks both invocation channels");
await selectMembers([member("dsh", "manual-only")]);
manualCandidate = (await selectedCandidates()).find(item => item.name === "manual-only");
ok(manualCandidate && !manualCandidate.invocation.modelInvocable && manualCandidate.invocation.userInvocable, "reselection restores only source-permitted channel");
eq(await readFile(join(dshRoot, "source-disabled", "SKILL.md"), "utf8"), sourceDisabledText, "source-disabled metadata unchanged");
eq(await readFile(join(dshRoot, "manual-only", "SKILL.md"), "utf8"), manualOnlyText, "manual-only metadata unchanged");

// ── External inventory becomes available only to the selected session ──
await makeSkill(codexRoot, "code-review", "---\nname: code-review\ndescription: Review code safely.\n---\nCodex review body");
await makeSkill(cursorRoot, "cursor-review", "---\nname: cursor-review\ndescription: Review code in Cursor.\n---\nCursor review body");
await selectMembers([member("codex", "code-review"), member("cursor", "cursor-review")]);
let providerCandidates = await selectedCandidates();
const codexCandidate = providerCandidates.find(item => item.source === "agent-codex" && item.name === "code-review");
ok(codexCandidate?.invocation.modelInvocable, "selected Codex skill is exposed");
eq(codexCandidate.rank, 510, "Codex rank below native DSH and public Agents");
eq((await getProviderSkill(codexCandidate, { sessionId: policySession })).content, "Codex review body", "provider loads external body");
const cursorCandidate = providerCandidates.find(item => item.name === "cursor-review");
ok(cursorCandidate?.invocation.modelInvocable, "selected Cursor skill is exposed");
eq(cursorCandidate?.rank, cursorDefinition.rank, "Cursor rank follows configured source priority");
const beforeRejectedSources = await readFile(managerStatePath(), "utf8");
for (const key of ["cursor", "dsh", "codex", "ccswitch"]) {
  for (const enabled of [false, true]) eq((await setSourceEnabled(key, enabled)).code, "error.policy.sessionOnly", `legacy source toggle ${key}/${enabled} rejected`);
}
eq(await readFile(managerStatePath(), "utf8"), beforeRejectedSources, "legacy source toggles never persist hidden policy");
ok((await selectedCandidates()).find(item => item.name === "cursor-review")?.invocation.modelInvocable, "rejected source toggle does not change session selection");
await selectMembers([member("codex", "code-review")]);
ok(!(await selectedCandidates()).find(item => item.name === "cursor-review")?.invocation.modelInvocable, "excluding Cursor member blocks it without hiding inventory");
ok(!(await readFile(join(cursorRoot, "cursor-review", "SKILL.md"), "utf8")).includes("disable-model-invocation"), "selection never modifies external source file");

// CC Switch 以固定 SSOT 保存技能，并把顶层技能目录链接到各 Agent 来源。
const ccswitchSkill = await makeSkill(
  ccswitchRoot,
  "ccswitch-shared",
  "---\nname: ccswitch-shared\ndescription: Shared by CC Switch.\n---\nCC Switch body",
);
const linkedCcSwitchSkill = join(codexRoot, "ccswitch-shared");
const readonlyOutsideRoot = join(tmp, "readonly-link-outside");
const readonlyOutsideSkill = await makeSkill(
  readonlyOutsideRoot,
  "outside-linked",
  "---\nname: outside-linked\ndescription: Outside trusted roots.\n---\nOutside body",
);
const providerLinkType = process.platform === "win32" ? "junction" : undefined;
if (await tryLink(ccswitchSkill, linkedCcSwitchSkill, providerLinkType)) {
  const linkedCodexEntry = (await scanEntries(codexRoot)).entries.find(
    (entry) => entry.name === "ccswitch-shared",
  );
  ok(
    linkedCodexEntry && linkedCodexEntry.linked === true,
    "user read-only roots discover a trusted top-level linked Skill bundle",
  );
  ok(
    (await resolveEntry(codexRoot, "ccswitch-shared")) !== null,
    "resolveEntry resolves a trusted top-level linked Skill bundle",
  );

  const ccswitchState = await state();
  const ccswitchView = ccswitchState.roots.find(
    (root) => root.key === "ccswitch",
  );
  const codexView = ccswitchState.roots.find((root) => root.key === "codex");
  ok(
    ccswitchView &&
      ccswitchView.enabled === true &&
      ccswitchView.skills.some((skill) => skill.name === "ccswitch-shared"),
    "CC Switch inventory source stays visible and owns its SSOT Skill",
  );
  ok(
    codexView &&
      !codexView.skills.some((skill) => skill.name === "ccswitch-shared"),
    "state deduplicates a CC Switch Skill distributed into Codex by real path",
  );
  eq(
    (await skillDetail("codex", "ccswitch-shared")).code,
    "error.skill.notFound",
    "detail hides a Codex distribution link that state deduplicates away",
  );
  eq(
    (await skillDetail("ccswitch", "ccswitch-shared")).body,
    "CC Switch body",
    "detail keeps the direct CC Switch SSOT visible without scanning unrelated skill documents",
  );

  await selectMembers([member("ccswitch", "ccswitch-shared")]);
  const ccswitchCandidates = (await selectedCandidates()).filter(
    (item) => item.name === "ccswitch-shared",
  );
  eq(
    ccswitchCandidates.length,
    1,
    "provider deduplicates a CC Switch Skill distributed to another Agent root",
  );
  eq(
    ccswitchCandidates[0] && ccswitchCandidates[0].source,
    "agent-ccswitch",
    "provider keeps the direct CC Switch source as the canonical candidate",
  );
  const loadedCcSwitch = ccswitchCandidates[0]
    ? await getProviderSkill(ccswitchCandidates[0])
    : undefined;
  eq(
    loadedCcSwitch && loadedCcSwitch.content,
    "CC Switch body",
    "provider loads the canonical CC Switch Skill body",
  );

  await setSourceEnabled("ccswitch", false);
  const disabledCcSwitchCandidates = (await listProviderCandidates()).filter(
    (item) => item.name === "ccswitch-shared",
  );
  eq(
    disabledCcSwitchCandidates.length,
    1,
    "rejected CC Switch toggle preserves its canonical inventory candidate",
  );
  await setSourceEnabled("ccswitch", true);

  const linkedCandidate = {
    name: linkedCodexEntry.declaredName,
    description: linkedCodexEntry.description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: "dsh-loadout-external",
    source: "agent-codex",
    locator: {
      rootKey: "codex",
      entryName: linkedCodexEntry.name,
      path: linkedCodexEntry.docPath,
      realEntryPath: linkedCodexEntry.realEntryPath,
      realDocPath: linkedCodexEntry.realDocPath,
    },
    resourceBase: { kind: "directory", path: linkedCodexEntry.realEntryPath },
    path: linkedCodexEntry.docPath,
    metadata: {},
  };
  eq(
    await getProviderSkill(linkedCandidate),
    undefined,
    "provider rejects a fabricated distribution alias instead of bypassing the canonical winner",
  );
  const missingRealEntryLocator = {
    ...linkedCandidate,
    locator: { ...linkedCandidate.locator },
  };
  delete missingRealEntryLocator.locator.realEntryPath;
  eq(
    await getProviderSkill(missingRealEntryLocator),
    undefined,
    "provider rejects a user candidate missing its discovered real bundle path",
  );
  const missingRealDocLocator = {
    ...linkedCandidate,
    locator: { ...linkedCandidate.locator },
  };
  delete missingRealDocLocator.locator.realDocPath;
  eq(
    await getProviderSkill(missingRealDocLocator),
    undefined,
    "provider rejects a user candidate missing its discovered real document path",
  );
  const replacementSkill = await makeSkill(
    ccswitchRoot,
    "ccswitch-replacement",
    "---\nname: ccswitch-shared\ndescription: Retargeted CC Switch Skill.\n---\nRetargeted body",
  );
  await rm(linkedCcSwitchSkill, { recursive: true, force: true });
  await symlink(replacementSkill, linkedCcSwitchSkill, providerLinkType);
  eq(
    await getProviderSkill(linkedCandidate),
    undefined,
    "provider rejects a trusted link retargeted after candidate discovery",
  );
  await rm(linkedCcSwitchSkill, { recursive: true, force: true });
  await symlink(ccswitchSkill, linkedCcSwitchSkill, providerLinkType);
  await rm(replacementSkill, { recursive: true, force: true });
} else {
  ok(
    true,
    "trusted user-source link tests skipped because this environment cannot create directory links",
  );
}
const writableLinkOutside = await makeSkill(
  join(tmp, "writable-link-outside"),
  "ccswitch-linked-dsh",
  "---\nname: ccswitch-linked-dsh\ndescription: Linked into DSH.\n---\nLinked body",
);
const writableTrustedLink = join(dshRoot, "ccswitch-linked-dsh");
if (await tryLink(writableLinkOutside, writableTrustedLink, providerLinkType)) {
  const linkedWritable = await resolveEntry(dshRoot, "ccswitch-linked-dsh");
  ok(
    linkedWritable && linkedWritable.linked === true,
    "writable DSH roots list a top-level directory link without following it for writes",
  );
  const scannedLink = (await scanEntries(dshRoot)).entries.find(
    (entry) => entry.name === "ccswitch-linked-dsh",
  );
  ok(
    scannedLink && scannedLink.linked === true,
    "writable DSH scans show the linked bundle",
  );
  const linkedView = (await state()).roots
    .find((root) => root.key === "dsh")
    .skills.find((skill) => skill.name === "ccswitch-linked-dsh");
  eq(linkedView && linkedView.linked, true, "skill list marks the directory link");
  const linkedDetail = await skillDetail("dsh", "ccswitch-linked-dsh");
  eq(linkedDetail.body, "Linked body", "detail reads the linked skill");
  eq(linkedDetail.sourceReadOnly, true, "detail marks the linked skill read-only");
  const linkedTargetBefore = await readFile(join(writableLinkOutside, "SKILL.md"), "utf8");
  const refusedDelete = await deleteSkill(dshRoot, "ccswitch-linked-dsh");
  eq(refusedDelete.code, "error.skill.linked", "delete refuses a writable-root directory link");
  ok(
    await resolveEntry(dshRoot, "ccswitch-linked-dsh"),
    "the directory link remains after a refused delete",
  );
  const replacementDir = await makeSkill(
    join(tmp, "link-overwrite-source"),
    "ccswitch-linked-dsh",
    "---\nname: ccswitch-linked-dsh\ndescription: Should not replace the link.\n---\nnope",
  );
  const refusedImport = await importSkill(replacementDir, null, {
    conflict: "overwrite",
  });
  eq(refusedImport.ok, false, "import does not overwrite a directory link");
  eq(
    refusedImport.failed && refusedImport.failed[0] && refusedImport.failed[0].code,
    "error.skill.linked",
    "import reports the directory link",
  );
  const refusedCreate = await createSkill({
    name: "ccswitch-linked-dsh",
    description: "Should not replace the link.",
    body: "nope",
  });
  eq(refusedCreate.code, "error.create.conflict", "create does not replace a directory link");
  const disabledLink = await setSkillEnabled(dshRoot, "ccswitch-linked-dsh", false);
  eq(disabledLink.code, "error.policy.sessionOnly", "linked legacy toggle cannot mutate policy");
  await setSkillEnabled(dshRoot, "ccswitch-linked-dsh", true);
  eq(
    await readFile(join(writableLinkOutside, "SKILL.md"), "utf8"),
    linkedTargetBefore,
    "refused writes leave the link target unchanged",
  );
  const fileLinkType = process.platform === "win32" ? "file" : undefined;
  if (await tryLink(join(writableLinkOutside, "SKILL.md"), join(dshRoot, "linked-flat.md"), fileLinkType)) {
    ok(
      !(await scanEntries(dshRoot)).entries.some((entry) => entry.name === "linked-flat"),
      "writable DSH scans still hide a flat markdown symlink",
    );
    await rm(join(dshRoot, "linked-flat.md"), { force: true });
  } else {
    ok(true, "flat markdown symlink test skipped because this environment cannot create file links");
  }
  const docLinkTarget = join(tmp, "doc-link-target");
  await mkdir(docLinkTarget, { recursive: true });
  const docLink = join(dshRoot, "doc-link-skill");
  if (
    await tryLink(join(writableLinkOutside, "SKILL.md"), join(docLinkTarget, "SKILL.md"), fileLinkType) &&
    await tryLink(docLinkTarget, docLink, providerLinkType)
  ) {
    ok(
      !(await scanEntries(dshRoot)).entries.some((entry) => entry.name === "doc-link-skill"),
      "writable DSH scans still hide a directory link whose SKILL.md is itself a link",
    );
    await rm(docLink, { force: true });
  } else {
    ok(true, "linked SKILL.md test skipped because this environment cannot create the links");
  }
  const projectSkills = join(tmp, "linked-project", ".dsh", "skills");
  await mkdir(projectSkills, { recursive: true });
  const projectTarget = await makeSkill(
    join(tmp, "project-link-outside"),
    "proj-linked",
    "---\nname: proj-linked\ndescription: Project link.\n---\nProject body",
  );
  if (await tryLink(projectTarget, join(projectSkills, "proj-linked"), providerLinkType)) {
    const projectEntry = (await scanEntries({
      key: "project-dsh:test",
      path: projectSkills,
      mutable: true,
      label: "Project DSH",
      rank: 100,
      native: true,
      toggleable: true,
    })).entries.find((entry) => entry.name === "proj-linked");
    ok(
      projectEntry && projectEntry.linked === true,
      "project DSH roots list a top-level directory link",
    );
  }
  await rm(writableTrustedLink, { recursive: true, force: true });
} else {
  ok(
    true,
    "writable-root trusted link test skipped because this environment cannot create directory links",
  );
}
const sameRootReadonlyLink = join(codexRoot, "code-review-alias");
if (
  await tryLink(
    join(codexRoot, "code-review"),
    sameRootReadonlyLink,
    providerLinkType,
  )
) {
  ok(
    (await scanEntries(codexRoot)).entries.some(
      (entry) => entry.name === "code-review-alias",
    ),
    "只读扫描跟随同根目录别名",
  );
  await rm(sameRootReadonlyLink, { recursive: true, force: true });
} else {
  ok(
    true,
    "same-root read-only link test skipped because this environment cannot create directory links",
  );
}
const outsideLinkedSkill = join(codexRoot, "outside-linked");
if (await tryLink(readonlyOutsideSkill, outsideLinkedSkill, providerLinkType)) {
  ok(
    (await scanEntries(codexRoot)).entries.some(
      (entry) => entry.name === "outside-linked",
    ),
    "只读扫描默认跟随外部目录链接",
  );
  await selectMembers([member("codex", "outside-linked")]);
  const discoveredLink = (await selectedCandidates()).find(item => item.name === "outside-linked");
  eq((await getProviderSkill(discoveredLink, { sessionId: policySession }))?.content, "Outside body", "selected discovered directory link loads its unchanged real target");
  for (const field of ["realEntryPath", "realDocPath"]) {
    const incompleteLocator = { ...discoveredLink, locator: { ...discoveredLink.locator } };
    delete incompleteLocator.locator[field];
    eq(await getProviderSkill(incompleteLocator, { sessionId: policySession }), undefined, `selected link rejects missing ${field}`);
  }
  const replacedLinkTarget = await makeSkill(readonlyOutsideRoot, "replacement", "---\nname: outside-linked\ndescription: Changed target.\n---\nReplacement body");
  await rm(outsideLinkedSkill, { recursive: true, force: true });
  await symlink(replacedLinkTarget, outsideLinkedSkill, providerLinkType);
  eq(await getProviderSkill(discoveredLink, { sessionId: policySession }), undefined, "selected cached link rejects a retargeted real document");
  await rm(outsideLinkedSkill, { recursive: true, force: true });
} else {
  ok(
    true,
    "outside-target link test skipped because this environment cannot create directory links",
  );
}
const hiddenCcSwitchSkill = await makeSkill(
  ccswitchRoot,
  ".hidden-ccswitch",
  "---\nname: hidden-ccswitch\ndescription: Hidden target.\n---\nHidden body",
);
const hiddenCcSwitchLink = join(codexRoot, "hidden-via-link");
if (await tryLink(hiddenCcSwitchSkill, hiddenCcSwitchLink, providerLinkType)) {
  ok(
    (await scanEntries(codexRoot)).entries.some(
      (entry) => entry.name === "hidden-via-link",
    ),
    "隐藏目录按发现路径过滤，可见链接允许指向隐藏目标",
  );
  await rm(hiddenCcSwitchLink, { recursive: true, force: true });
} else {
  ok(
    true,
    "hidden-target link test skipped because this environment cannot create directory links",
  );
}
const ccswitchAgentSkill = await makeSkill(
  ccswitchRoot,
  "ccswitch-agent-owned",
  "---\nname: ccswitch-agent-owned\ndescription: Direct CC Switch SSOT with a public Agent distribution link.\n---\nCC Switch Agent body",
);
const linkedAgentSkill = join(agentsRoot, "ccswitch-agent-owned");
if (await tryLink(ccswitchAgentSkill, linkedAgentSkill, providerLinkType)) {
  const linkedAgentState = await state();
  const linkedAgentCcSwitchView = linkedAgentState.roots.find(
    (root) => root.key === "ccswitch",
  );
  const linkedAgentPublicView = linkedAgentState.roots.find(
    (root) => root.key === "agents",
  );
  ok(
    linkedAgentCcSwitchView &&
      linkedAgentCcSwitchView.skills.some(
        (skill) => skill.name === "ccswitch-agent-owned",
      ),
    "a direct CC Switch SSOT keeps ownership when public Agents links to it",
  );
  ok(
    linkedAgentPublicView &&
      !linkedAgentPublicView.skills.some(
        (skill) => skill.name === "ccswitch-agent-owned",
      ),
    "state hides the public Agent distribution link owned by CC Switch",
  );
  await selectMembers([member("ccswitch", "ccswitch-agent-owned")]);
  let linkedAgentCandidates = (await selectedCandidates()).filter(
    (item) => item.name === "ccswitch-agent-owned",
  );
  eq(
    linkedAgentCandidates.length,
    1,
    "provider emits one candidate for a CC Switch Skill distributed to public Agents",
  );
  eq(
    linkedAgentCandidates[0] && linkedAgentCandidates[0].source,
    "agent-ccswitch",
    "provider attributes the public Agent distribution link to the direct CC Switch SSOT",
  );
  eq(
    linkedAgentCandidates[0] && linkedAgentCandidates[0].rank,
    450,
    "the direct CC Switch candidate inherits the strongest distribution entry rank",
  );
  await setSourceEnabled("ccswitch", false);
  linkedAgentCandidates = (await listProviderCandidates()).filter(
    (item) => item.name === "ccswitch-agent-owned",
  );
  ok(
    linkedAgentCandidates.length === 1 &&
      linkedAgentCandidates[0].source === "agent-ccswitch" &&
      linkedAgentCandidates[0].invocation.modelInvocable === false &&
      linkedAgentCandidates[0].invocation.userInvocable === false,
    "without session context the canonical CC Switch candidate blocks public Agent fallback",
  );
  await setSourceEnabled("ccswitch", true);
  await rm(linkedAgentSkill, { recursive: true, force: true });
} else {
  ok(
    true,
    "public Agent distribution-link ownership test skipped because this environment cannot create directory links",
  );
}
await rm(ccswitchAgentSkill, { recursive: true, force: true });
const ccswitchPolicyMigrationSkill = await makeSkill(
  ccswitchRoot,
  "policy-migration",
  "---\nname: policy-migration\ndescription: Canonical CC Switch Skill.\n---\nCC Switch canonical body",
);
const codexPolicyMigrationSkill = await makeSkill(
  codexRoot,
  "policy-migration",
  "---\nname: policy-migration\ndescription: Original Codex Skill.\n---\nCodex original body",
);
await setSkillEnabled(codexRoot, "policy-migration", false);
await rm(codexPolicyMigrationSkill, { recursive: true, force: true });
const codexPolicyMigrationLink = join(codexRoot, "policy-migration");
if (
  await tryLink(
    ccswitchPolicyMigrationSkill,
    codexPolicyMigrationLink,
    providerLinkType,
  )
) {
  const migratedPolicyCandidates = (await listProviderCandidates()).filter(
    (item) => item.name === "policy-migration",
  );
  eq(
    migratedPolicyCandidates.length,
    1,
    "a replaced Codex entry remains one canonical candidate after becoming a CC Switch distribution link",
  );
  ok(
    migratedPolicyCandidates[0] &&
      migratedPolicyCandidates[0].source === "agent-ccswitch" &&
      migratedPolicyCandidates[0].invocation.modelInvocable === false &&
      migratedPolicyCandidates[0].invocation.userInvocable === false,
    "unselected distribution link remains blocked after changing canonical ownership",
  );
  await selectMembers([member("ccswitch", "policy-migration")]);
  const explicitlyEnabledMigration = (await selectedCandidates()).find(
    (item) => item.name === "policy-migration",
  );
  ok(
    explicitlyEnabledMigration &&
      explicitlyEnabledMigration.invocation.modelInvocable === true &&
      explicitlyEnabledMigration.invocation.userInvocable === true,
    "explicit canonical CC Switch session selection makes distribution available",
  );
  await rm(codexPolicyMigrationLink, { recursive: true, force: true });
} else {
  ok(
    true,
    "cross-source policy migration test skipped because this environment cannot create directory links",
  );
}
await rm(ccswitchPolicyMigrationSkill, { recursive: true, force: true });
await setSkillEnabled(codexRoot, "code-review", false);
providerCandidates = await listProviderCandidates();
ok(
  providerCandidates.find((item) => item.name === "code-review").invocation
    .modelInvocable === false,
  "external skill disable keeps a disabled winning candidate",
);
ok(
  !(
    await readFile(join(codexRoot, "code-review", "SKILL.md"), "utf8")
  ).includes("disable-model-invocation"),
  "external skill toggle never modifies the source file",
);
await setSourceEnabled("codex", false);
providerCandidates = await listProviderCandidates();
const disabledExternalCandidate = providerCandidates.find((item) => item.name === "code-review");
ok(
  disabledExternalCandidate &&
    disabledExternalCandidate.invocation.modelInvocable === false &&
    disabledExternalCandidate.invocation.userInvocable === false,
  "关闭外部来源仍保留已有的显式单技能阻断",
);
await setSourceEnabled("codex", true);

// 已存在但损坏的状态文件必须 fail-closed，且任何后续启停不得覆盖原文件。
const validManagerState = await readFile(managerStatePath(), "utf8");
const legacyManagerState = JSON.parse(validManagerState);
delete legacyManagerState.enabledSkills.cursor;
delete legacyManagerState.sources.cursor;
delete legacyManagerState.disabledSkills.cursor;
delete legacyManagerState.enabledSkills;
delete legacyManagerState.disabledSkills.dsh;
delete legacyManagerState.sources.ccswitch;
delete legacyManagerState.disabledSkills.ccswitch;
delete legacyManagerState.sources.antigravity;
delete legacyManagerState.disabledSkills.antigravity;
await writeFile(managerStatePath(), JSON.stringify(legacyManagerState), "utf8");
const migratedLegacyState = await readManagerState();
ok(
  migratedLegacyState.writable === true &&
    Array.isArray(migratedLegacyState.state.enabledSkills.dsh),
  "legacy state without enabledSkills or a DSH policy list is normalized compatibly",
);
for (const key of ["ccswitch", "antigravity", "cursor"]) {
  eq(migratedLegacyState.state.sources[key], undefined, `absent legacy source ${key} remains opaque migration data`);
  eq(migratedLegacyState.state.disabledSkills[key], undefined, `absent legacy exclusions ${key} are not manufactured`);
}
eq(await readFile(managerStatePath(), "utf8"), JSON.stringify(legacyManagerState), "reading legacy state never persists normalization");
eq((await state()).summary.enabled, 0, "missing legacy source defaults cannot enable unselected inventory");
const conflictingManagerState = JSON.parse(validManagerState);
conflictingManagerState.disabledSkills.dsh = ["good-skill"];
conflictingManagerState.enabledSkills.dsh = ["good-skill"];
await writeFile(
  managerStatePath(),
  JSON.stringify(conflictingManagerState),
  "utf8",
);
ok(
  (await readManagerState()).writable === true,
  "conflicting legacy policy entries are inert rather than corrupting session state",
);
await writeFile(managerStatePath(), validManagerState, "utf8");
await writeFile(managerStatePath(), "{broken", "utf8");
const invalidManagerState = await readManagerState();
ok(
  invalidManagerState.writable === false,
  "invalid manager state locks subsequent writes",
);
ok(
  Object.values(invalidManagerState.state.sources).every(
    (enabled) => enabled === false,
  ),
  "invalid manager state fails closed for every external source",
);
const rejectedStateToggle = await setSourceEnabled("codex", true);
eq(
  rejectedStateToggle.code,
  "error.policy.sessionOnly",
  "retired source toggle rejects before any invalid-state write",
);
eq(
  await readFile(managerStatePath(), "utf8"),
  "{broken",
  "rejected state toggle preserves the unreadable file for recovery",
);
providerCandidates = await listProviderCandidates();
ok(
  providerCandidates.filter((item) => item.name === "code-review").every(item => !item.invocation.modelInvocable && !item.invocation.userInvocable),
  "invalid manager state never exposes callable external candidates",
);
ok(
  providerCandidates.find(
    (item) => item.source === "user-dsh" && item.name === "good-skill",
  ).invocation.modelInvocable === false,
  "invalid manager state also installs a fail-closed policy candidate for user DSH skills",
);
await writeFile(managerStatePath(), validManagerState, "utf8");

// ── 创建与详情 ──
const created = await createSkill({
  name: "Conversation Helper",
  description: "Create reusable prompts.",
  body: "Follow the user request carefully.",
});
eq(
  created.name,
  "conversation-helper",
  "createSkill normalizes a conversation title to kebab-case",
);
const createdDetail = await skillDetail("dsh", "conversation-helper");
eq(
  createdDetail.body,
  "Follow the user request carefully.",
  "skillDetail returns the markdown body",
);
ok(
  createdDetail.document.includes("name: conversation-helper") && createdDetail.document.includes("Follow the user request carefully."),
  "skillDetail returns the SKILL.md source",
);
ok(
  createdDetail.loadable === true && createdDetail.diagnostics.length === 0,
  "created skill passes diagnostics",
);
eq(
  (
    await createSkill({
      name: "Conversation Helper",
      description: "Duplicate.",
      body: "body",
    })
  ).code,
  "error.create.conflict",
  "createSkill rejects overwrite by default",
);

// ── 删除 ──
const deleted = await deleteSkill(dshRoot, "good-skill");
eq(deleted.name, "good-skill", "deleteSkill returns deleted name");
ok(
  (await resolveEntry(dshRoot, "good-skill")) === null,
  "deleteSkill removes bundle",
);
ok(
  (await listTrash()).some((item) => item.id === deleted.id),
  "deleteSkill moves the skill into trash",
);
const restored = await restoreTrash(deleted.id);
eq(restored.name, "good-skill", "restoreTrash returns restored name");
ok(
  (await resolveEntry(dshRoot, "good-skill")) !== null,
  "restoreTrash restores the skill bundle",
);
const deletedAgain = await deleteSkill(dshRoot, "good-skill");
await permanentlyDeleteTrash(deletedAgain.id);
ok(
  !(await listTrash()).some((item) => item.id === deletedAgain.id),
  "permanent trash deletion removes the second-stage entry",
);
const publicDelete = await deleteSkill(agentsRoot, "public-skill");
ok(!!publicDelete.id, "公共 Agent 普通技能允许移入回收站");
await restoreTrash(publicDelete.id);

// Windows 可能在 stage 内容刚写完时持续阻止目录 rename；最终发布应降级复制，不能把成功的搬运回滚掉。
await makeSkill(
  dshRoot,
  "trash-publish-fallback",
  "---\nname: trash-publish-fallback\ndescription: Publish fallback.\n---\nbody",
);
await writeFile(
  join(dshRoot, "trash-publish-fallback", "asset.txt"),
  "kept",
  "utf8",
);
let trashPublishAttempts = 0;
const fallbackDeleted = await deleteSkill(
  dshRoot,
  "trash-publish-fallback",
  null,
  {
    renameOptions: {
      maxAttempts: 2,
      delayMs: 0,
      async rename(source, destination) {
        if (
          basename(source).startsWith(".stage-") &&
          dirname(source) === dirname(destination)
        ) {
          trashPublishAttempts++;
          const error = new Error(
            "Windows scanner keeps the stage directory busy",
          );
          error.code = "EPERM";
          throw error;
        }
        return rename(source, destination);
      },
    },
  },
);
eq(
  trashPublishAttempts,
  2,
  "deleteSkill exhausts the bounded final rename retries before fallback",
);
ok(
  (await resolveEntry(dshRoot, "trash-publish-fallback")) === null,
  "trash publish fallback keeps the source removed",
);
ok(
  (await listTrash()).some((item) => item.id === fallbackDeleted.id),
  "trash publish fallback creates a visible trash item",
);
await restoreTrash(fallbackDeleted.id);
eq(
  await readFile(join(dshRoot, "trash-publish-fallback", "asset.txt"), "utf8"),
  "kept",
  "trash publish fallback preserves nested files through restore",
);

// 项目根与 manager Trash 可能位于不同盘符；EXDEV 时复制后在源盘原子隐藏，恢复同样降级。
const crossDeviceBundle = await makeSkill(
  dshRoot,
  "cross-device-trash",
  "---\nname: cross-device-trash\ndescription: Cross-device fallback.\n---\nbody",
);
await writeFile(
  join(crossDeviceBundle, "asset.txt"),
  "cross-device-kept",
  "utf8",
);
let crossDeviceDeleteFallbacks = 0;
const crossDeviceDeleted = await deleteSkill(
  dshRoot,
  "cross-device-trash",
  null,
  {
    renameOptions: {
      maxAttempts: 1,
      async rename(source, destination) {
        if (
          source === crossDeviceBundle &&
          destination.includes(`${sep}.stage-`)
        ) {
          crossDeviceDeleteFallbacks++;
          const error = new Error("simulated cross-device delete");
          error.code = "EXDEV";
          throw error;
        }
        return rename(source, destination);
      },
    },
  },
);
eq(
  crossDeviceDeleteFallbacks,
  1,
  "deleteSkill falls back exactly once after EXDEV",
);
ok(
  (await resolveEntry(dshRoot, "cross-device-trash")) === null,
  "cross-device delete hides the source entry",
);
let crossDeviceRestoreFallbacks = 0;
await restoreTrash(crossDeviceDeleted.id, null, {
  renameOptions: {
    maxAttempts: 1,
    async rename(source, destination) {
      if (
        basename(source) === "cross-device-trash" &&
        destination === crossDeviceBundle
      ) {
        crossDeviceRestoreFallbacks++;
        const error = new Error("simulated cross-device restore");
        error.code = "EXDEV";
        throw error;
      }
      return rename(source, destination);
    },
  },
});
eq(
  crossDeviceRestoreFallbacks,
  1,
  "restoreTrash falls back exactly once after EXDEV",
);
eq(
  await readFile(join(crossDeviceBundle, "asset.txt"), "utf8"),
  "cross-device-kept",
  "cross-device restore preserves the complete bundle",
);

// 删除发生二次故障时必须保留未恢复的 stage，不能清理唯一副本。
const rollbackBundle = await makeSkill(
  dshRoot,
  "rollback-risk",
  "---\nname: rollback-risk\ndescription: Bundle.\n---\nbody",
);
const rollbackFlat = join(dshRoot, "rollback-risk.md");
await writeFile(
  rollbackFlat,
  "---\nname: rollback-risk\ndescription: Flat.\n---\nbody",
  "utf8",
);
let rollbackDeleteError = null;
try {
  await deleteSkill(dshRoot, "rollback-risk", null, {
    renameOptions: {
      maxAttempts: 1,
      delayMs: 0,
      async rename(source, destination) {
        if (source === rollbackFlat) {
          const error = new Error("primary move failure");
          error.code = "EIO";
          throw error;
        }
        if (
          destination === rollbackBundle &&
          source.includes(`${sep}.stage-`)
        ) {
          const error = new Error("rollback failure");
          error.code = "EACCES";
          throw error;
        }
        return rename(source, destination);
      },
    },
  });
} catch (error) {
  rollbackDeleteError = error;
}
eq(
  rollbackDeleteError && rollbackDeleteError.code,
  "error.trash.rollbackFailed",
  "deleteSkill reports a rollback-specific error after a double failure",
);
ok(
  rollbackDeleteError &&
    rollbackDeleteError.params &&
    rollbackDeleteError.params.path,
  "delete rollback failure reports the preserved stage path",
);
let preservedRollbackCopy = false;
try {
  const kept = await stat(
    join(rollbackDeleteError.params.path, "rollback-risk"),
  );
  preservedRollbackCopy = kept.isDirectory();
} catch {}
ok(
  preservedRollbackCopy,
  "deleteSkill preserves the only unrecovered bundle copy in stage",
);
ok(
  await stat(rollbackFlat).then(
    () => true,
    () => false,
  ),
  "deleteSkill leaves the entry that never moved at its original path",
);

async function tryLink(target, path, type) {
  try {
    if (type) await symlink(target, path, type);
    else await symlink(target, path);
    return true;
  } catch {
    return false;
  }
}

const leftoverDir = join(dshRoot, ".good-skill.dssm-stage-dead");
await mkdir(leftoverDir, { recursive: true });
await writeFile(
  join(leftoverDir, "SKILL.md"),
  "---\nname: leftover\n---\nbody",
  "utf8",
);
ok(
  !(await scanEntries(dshRoot)).entries.some((item) =>
    item.name.startsWith("."),
  ),
  "scan hides crash leftover stage directories",
);

const outsidePayload = await makeSkill(
  join(tmp, "outside-payload"),
  "payload",
  "---\nname: payload\n---\nsecret",
);
const plantedLink = join(dshRoot, "evil-link");
const linkType = process.platform === "win32" ? "junction" : undefined;
if (await tryLink(outsidePayload, plantedLink, linkType)) {
  const planted = await resolveEntry(dshRoot, "evil-link");
  ok(
    planted && planted.linked === true,
    "resolveEntry lists an outside directory link as read-only",
  );
  ok(
    (await scanEntries(dshRoot)).entries.some(
      (item) => item.name === "evil-link" && item.linked === true,
    ),
    "scan lists symlink bundles as linked entries",
  );
  const outsideDoc = await readFile(join(outsidePayload, "SKILL.md"), "utf8");
  const linkedToggle = await setSkillEnabled(dshRoot, "evil-link", false);
  ok(
    linkedToggle.ok === false,
    "enable/disable refuses a directory link whose skill is not loadable",
  );
  eq(
    await readFile(join(outsidePayload, "SKILL.md"), "utf8"),
    outsideDoc,
    "symlink toggle does not rewrite files outside the skill root",
  );
  const plantedDelete = await deleteSkill(dshRoot, "evil-link");
  eq(plantedDelete.code, "error.skill.linked", "delete refuses a directory link that leaves the skill root");
  eq(
    await readFile(join(outsidePayload, "SKILL.md"), "utf8"),
    outsideDoc,
    "refused delete does not follow the directory link",
  );
  await rm(plantedLink, { force: true });
} else {
  ok(
    true,
    "symlink write-through test skipped because this environment cannot create directory links",
  );
}

const aliasHome = join(tmp, "alias-home");
if (await tryLink(process.env.DSH_HOME, aliasHome, linkType)) {
  const viaAlias = await importSkill(join(aliasHome, "skills"), null, {
    dryRun: true,
  });
  eq(
    viaAlias.code,
    "error.import.overlap",
    "import overlap follows intermediate directory links",
  );
} else {
  ok(
    true,
    "intermediate-link overlap test skipped because this environment cannot create directory links",
  );
}
ok(!!publicDelete.id, "公共 Agent 回收返回有效条目编号");
ok(
  (await resolveEntry(agentsRoot, "public-skill")) !== null,
  "公共 Agent 技能恢复后保留原内容",
);
await writeFile(
  join(dshRoot, "SKILL.md"),
  "---\nname: root\n---\nbody",
  "utf8",
);
await writeFile(
  join(process.env.DSH_HOME, "SKILL.md"),
  "---\nname: dsh-home\n---\nbody",
  "utf8",
);
ok(
  (await resolveEntry(dshRoot, ".")) === null,
  "resolveEntry rejects current-directory traversal",
);
ok(
  (await resolveEntry(dshRoot, "..")) === null,
  "resolveEntry rejects parent-directory traversal",
);
ok(
  (await resolveEntry(dshRoot, "...")) === null,
  "resolveEntry rejects Windows-normalized dot names",
);
const dotDelete = await deleteSkill(dshRoot, ".");
ok(dotDelete.ok === false, "deleteSkill rejects current-directory traversal");
await makeSkill(dshRoot, "safe-bar", "---\nname: safe-bar\n---\nbody");
const nestedDelete = await deleteSkill(dshRoot, "foo/../safe-bar");
ok(nestedDelete.ok === false, "deleteSkill rejects nested traversal");
ok(
  (await resolveEntry(dshRoot, "safe-bar")) !== null,
  "nested delete leaves the target skill unchanged",
);
await writeFile(
  join(dshRoot, "flat-delete.md"),
  "---\nname: flat-delete\n---\nbody",
  "utf8",
);
const flatDeleted = await deleteSkill(dshRoot, "flat-delete");
eq(flatDeleted.name, "flat-delete", "deleteSkill deletes a flat skill");
ok(
  (await resolveEntry(dshRoot, "flat-delete")) === null,
  "flat skill no longer resolves after delete",
);
await makeSkill(dshRoot, "dual-shape", "---\nname: dual-shape\n---\nbundle");
await writeFile(
  join(dshRoot, "dual-shape.md"),
  "---\nname: dual-shape\n---\nflat",
  "utf8",
);
await deleteSkill(dshRoot, "dual-shape");
ok(
  (await resolveEntry(dshRoot, "dual-shape")) === null,
  "deleteSkill removes both bundle and flat forms of one skill",
);
await makeSkill(dshRoot, "dual-scan", "---\nname: dual-scan\n---\nbundle");
await writeFile(
  join(dshRoot, "dual-scan.md"),
  "---\nname: dual-scan\n---\nflat",
  "utf8",
);
eq(
  (await scanEntries(dshRoot)).entries.filter(
    (item) => item.name === "dual-scan",
  ).length,
  1,
  "scan keeps one row when bundle and flat share a name",
);
eq(
  (await scanEntries(dshRoot)).entries.find((item) => item.name === "dual-scan")
    .kind,
  "bundle",
  "scan prefers the bundle form over the flat file",
);

// 删除必须清掉指向目录的伴随链接本身，且不跟随链接误删目标内容。
const altDirTarget = join(tmp, "alt-dir-target");
await mkdir(altDirTarget, { recursive: true });
if (await tryLink(altDirTarget, join(dshRoot, "alt-dir.md"), linkType)) {
  await makeSkill(dshRoot, "alt-dir", "---\nname: alt-dir\n---\nbundle");
  await deleteSkill(dshRoot, "alt-dir");
  let altDirLinkExists = true;
  try {
    await stat(join(dshRoot, "alt-dir.md"));
  } catch {
    altDirLinkExists = false;
  }
  ok(
    altDirLinkExists === false,
    "deleteSkill removes an alternate link that points at a directory",
  );
  let targetStillExists = true;
  try {
    await stat(altDirTarget);
  } catch {
    targetStillExists = false;
  }
  ok(
    targetStillExists,
    "deleteSkill does not follow the alternate link to its target",
  );
} else {
  ok(
    true,
    "alternate-link delete test skipped because this environment cannot create directory links",
  );
}

// ── 导入 ──
const srcSkill = await makeSkill(
  tmp,
  "Import Me",
  "---\nname: import-me\ndescription: Imported.\n---\nbody",
);
const imp = await importSkill(join(srcSkill, "SKILL.md"), null);
eq(imp.imported.length, 1, "import single dir");
eq(imp.imported[0].name, "import-me", "import kebabifies name");
const importedEntry = await resolveEntry(dshRoot, "import-me");
ok(importedEntry !== null, "imported entry resolvable");

// 浏览器上传：同一个入口接收单个 SKILL.md、完整文件夹与 ZIP，不依赖本机绝对路径。
const uploadedSingle = await importUploadedSkill(
  {
    name: "SKILL.md",
    entries: [
      {
        path: "SKILL.md",
        data: Buffer.from(
          "---\nname: uploaded-single\ndescription: Uploaded.\n---\nbody",
          "utf8",
        ).toString("base64"),
      },
    ],
  },
  null,
);
eq(
  uploadedSingle.imported.length,
  1,
  "uploaded SKILL.md imports through staged content",
);
ok(
  await readFile(join(dshRoot, "uploaded-single", "SKILL.md"), "utf8").then(
    (text) => text.includes("Uploaded."),
  ),
  "uploaded SKILL.md keeps its content",
);
eq(
  (
    await importUploadedSkill(
      { name: "SKILL.md", entries: [{ path: "SKILL.md", data: "%%%=" }] },
      null,
    )
  ).code,
  "error.upload.encoding",
  "uploaded content rejects non-Base64 characters",
);
eq(
  (
    await importUploadedSkill(
      { name: "SKILL.md", entries: [{ path: "SKILL.md", data: "A===" }] },
      null,
    )
  ).code,
  "error.upload.encoding",
  "uploaded content rejects invalid Base64 padding",
);

const uploadedFolder = await importUploadedSkill(
  {
    name: "uploaded-folder",
    entries: [
      {
        path: "uploaded-folder/SKILL.md",
        data: Buffer.from(
          "---\nname: uploaded-folder\ndescription: Folder.\n---\nbody",
          "utf8",
        ).toString("base64"),
      },
      {
        path: "uploaded-folder/scripts/run.js",
        data: Buffer.from("console.log('ok')\n", "utf8").toString("base64"),
      },
    ],
  },
  null,
);
eq(uploadedFolder.imported.length, 1, "uploaded folder imports as one skill");
eq(
  await readFile(join(dshRoot, "uploaded-folder", "scripts", "run.js"), "utf8"),
  "console.log('ok')\n",
  "uploaded folder keeps nested resources",
);

const zipBytes = zipSync({
  "uploaded-zip/SKILL.md": strToU8(
    "---\nname: uploaded-zip\ndescription: Zip.\n---\nbody",
  ),
  "uploaded-zip/references/info.md": strToU8("reference"),
});
const uploadedZip = await importUploadedSkill(
  { name: "uploaded-zip.zip", zip: Buffer.from(zipBytes).toString("base64") },
  null,
);
eq(uploadedZip.imported.length, 1, "uploaded ZIP imports as one skill");
eq(
  await readFile(
    join(dshRoot, "uploaded-zip", "references", "info.md"),
    "utf8",
  ),
  "reference",
  "uploaded ZIP keeps nested resources",
);

const traversalUpload = await importUploadedSkill(
  {
    name: "unsafe-folder",
    entries: [
      {
        path: "../escaped.txt",
        data: Buffer.from("escape").toString("base64"),
      },
    ],
  },
  null,
);
eq(
  traversalUpload.code,
  "error.upload.path",
  "uploaded folder rejects traversal paths",
);
let escapedUploadExists = true;
try {
  await stat(join(process.env.DSH_HOME, "escaped.txt"));
} catch {
  escapedUploadExists = false;
}
ok(
  !escapedUploadExists,
  "rejected uploaded traversal never writes outside staging",
);

const traversalZip = zipSync({ "../escaped-zip.txt": strToU8("escape") });
const unsafeZip = await importUploadedSkill(
  { name: "unsafe.zip", zip: Buffer.from(traversalZip).toString("base64") },
  null,
);
eq(unsafeZip.code, "error.upload.path", "uploaded ZIP rejects traversal paths");
const formerOversizedArchive = await importUploadedSkill(
  { name: "eleven-mib.zip", zip: Buffer.alloc(11 << 20).toString("base64") },
  null,
);
eq(
  formerOversizedArchive.code,
  "error.upload.zipInvalid",
  "an 11 MiB archive passes the former 10 MiB size ceiling before ZIP validation",
);

// 已安装目录不能作为导入来源，否则覆盖会先删除来源再复制。
const selfImport = await importSkill(dshRoot, null, { dryRun: true });
ok(
  selfImport.ok === false,
  "import rejects a source inside the DSH skills root",
);
eq(
  selfImport.code,
  "error.import.overlap",
  "self import carries the overlap code",
);
const parentImport = await importSkill(tmp, null, { dryRun: true });
ok(
  parentImport.ok === false,
  "import rejects a source that contains the DSH skills root",
);
eq(
  parentImport.code,
  "error.import.overlap",
  "parent import carries the overlap code",
);
const namesBeforeHomeImport = (await scanEntries(dshRoot)).entries
  .map((entry) => entry.name)
  .sort()
  .join(",");
const homeSkillImport = await importSkill(
  join(process.env.DSH_HOME, "SKILL.md"),
  null,
  { dryRun: true },
);
ok(
  homeSkillImport.ok === false &&
    homeSkillImport.error.includes(
      "导入来源不能与 DSH 技能目录相同、包含或位于其中",
    ),
  "import rejects a SKILL.md whose parent contains the DSH skills root",
);
eq(
  homeSkillImport.code,
  "error.import.overlap",
  "home SKILL.md import carries the overlap code",
);
eq(
  (await scanEntries(dshRoot)).entries
    .map((entry) => entry.name)
    .sort()
    .join(","),
  namesBeforeHomeImport,
  "rejected home SKILL.md import leaves skills unchanged",
);

// 重名 dry-run
const dry = await importSkill(join(srcSkill, "SKILL.md"), null, {
  dryRun: true,
});
eq(dry.conflicts.length, 1, "import dryRun detects conflict");
eq(dry.pending.length, 0, "import dryRun pending empty on conflict");

// dry-run 预检与实际导入对符号链接口径一致：SKILL.md 本身是链接时，预检阶段即拒绝。
const docLinkTarget = join(tmp, "doc-link-target.md");
await writeFile(docLinkTarget, "---\nname: doc-link\n---\nbody", "utf8");
const linkedDocSkill = join(tmp, "linked-doc-skill");
await mkdir(linkedDocSkill, { recursive: true });
if (await tryLink(docLinkTarget, join(linkedDocSkill, "SKILL.md"))) {
  const singleDryLink = await importSkill(linkedDocSkill, null, {
    dryRun: true,
  });
  ok(
    singleDryLink.ok === false,
    "dry-run rejects a single source whose SKILL.md is a symlink",
  );
  eq(
    singleDryLink.code,
    "error.source.symlink",
    "single dry-run symlink carries the code",
  );
  const batchLinkDir = join(tmp, "batch-link");
  await mkdir(batchLinkDir, { recursive: true });
  await mkdir(join(batchLinkDir, "holder"), { recursive: true });
  await tryLink(docLinkTarget, join(batchLinkDir, "holder", "SKILL.md"));
  const batchDryLink = await importSkill(batchLinkDir, null, { dryRun: true });
  ok(
    batchDryLink.ok === false,
    "dry-run rejects a batch containing a symlinked SKILL.md",
  );
  eq(
    batchDryLink.code,
    "error.source.symlink",
    "batch dry-run symlink carries the code",
  );
} else {
  ok(
    true,
    "symlink dry-run tests skipped because this environment cannot create file links",
  );
}
// 覆盖
const overwrite = await importSkill(join(srcSkill, "SKILL.md"), null, {
  conflict: "overwrite",
});
eq(overwrite.imported.length, 1, "import overwrite");
ok(
  overwrite.imported[0].overwritten === true,
  "import overwrite marks overwritten",
);

// 跨形态重名：foo.md 与 foo\SKILL.md 视为同一技能，覆盖时只保留新形态。
await writeFile(
  join(dshRoot, "cross-shape.md"),
  "---\nname: cross-shape\n---\nflat",
  "utf8",
);
const crossShapeSource = await makeSkill(
  tmp,
  "cross-shape",
  "---\nname: cross-shape\n---\nbundle",
);
const crossShapeDryRun = await importSkill(
  join(crossShapeSource, "SKILL.md"),
  null,
  { dryRun: true },
);
eq(
  crossShapeDryRun.conflicts.length,
  1,
  "cross-shape duplicate is detected as a conflict",
);
const crossShapeOverwrite = await importSkill(
  join(crossShapeSource, "SKILL.md"),
  null,
  { conflict: "overwrite" },
);
eq(
  crossShapeOverwrite.imported.length,
  1,
  "cross-shape overwrite imports bundle",
);
ok(
  await resolveEntry(dshRoot, "cross-shape").then(
    (entry) => entry.kind === "bundle",
  ),
  "cross-shape overwrite keeps bundle",
);
let crossShapeFlatExists = true;
try {
  await readFile(join(dshRoot, "cross-shape.md"), "utf8");
} catch {
  crossShapeFlatExists = false;
}
ok(crossShapeFlatExists === false, "cross-shape overwrite removes flat entry");

// 单条导入完全失败必须返回错误，不能被客户端显示为上传完成。
const invalidSource = join(tmp, "中文技能.md");
await writeFile(invalidSource, "---\nname: invalid\n---\nbody", "utf8");
const invalidImport = await importSkill(invalidSource, null);
ok(invalidImport.ok === false, "failed single import returns an error result");
eq(
  invalidImport.failed.length,
  1,
  "failed single import includes failure detail",
);
eq(
  invalidImport.failed[0].code,
  "error.import.invalidName",
  "invalid kebab name carries the code",
);
eq(
  invalidImport.failed[0].params && invalidImport.failed[0].params.name,
  "中文技能",
  "invalid kebab name params",
);
eq(
  invalidImport.code,
  "error.import.failed",
  "fully failed import carries the aggregate code",
);
eq(
  invalidImport.error,
  invalidImport.failed.map((item) => item.error).join("；"),
  "aggregate error preserves the original zh text",
);

const partialBatchDir = join(tmp, "partial-batch");
await mkdir(partialBatchDir, { recursive: true });
await writeFile(
  join(partialBatchDir, "valid.md"),
  "---\nname: valid\n---\nbody",
  "utf8",
);
await writeFile(
  join(partialBatchDir, "无效.md"),
  "---\nname: invalid\n---\nbody",
  "utf8",
);
const partialImport = await importSkill(partialBatchDir, null);
eq(partialImport.imported.length, 1, "partial import keeps successful entries");
eq(
  partialImport.failed.length,
  1,
  "partial import returns failed entry details",
);
eq(
  partialImport.failed[0].code,
  "error.import.invalidName",
  "partial import failed item carries the code",
);
ok(
  partialImport.error === undefined,
  "partial import does not surface a top-level error",
);

const duplicateBatchDir = join(tmp, "duplicate-batch");
await mkdir(duplicateBatchDir, { recursive: true });
await writeFile(
  join(duplicateBatchDir, "Foo Bar.md"),
  "---\nname: foo-bar\n---\nfirst",
  "utf8",
);
await writeFile(
  join(duplicateBatchDir, "foo-bar.md"),
  "---\nname: foo-bar\n---\nsecond",
  "utf8",
);
const duplicateBatch = await importSkill(duplicateBatchDir, null, {
  dryRun: true,
});
ok(
  duplicateBatch.ok === false,
  "batch import rejects candidates with the same normalized name",
);
eq(
  duplicateBatch.failed.length,
  2,
  "duplicate batch reports every colliding candidate",
);
eq(
  duplicateBatch.failed[0].code,
  "error.import.duplicateName",
  "duplicate batch carries the code",
);
eq(
  duplicateBatch.failed[0].params && duplicateBatch.failed[0].params.name,
  "foo-bar",
  "duplicate batch params.name",
);

const emptyBatchDir = join(tmp, "empty-batch");
await mkdir(emptyBatchDir, { recursive: true });
const emptyImport = await importSkill(emptyBatchDir, null);
ok(emptyImport.ok === false, "empty batch dir returns an error result");
eq(
  emptyImport.code,
  "error.import.emptySource",
  "empty batch carries the emptySource code",
);
eq(
  emptyImport.params && emptyImport.params.path,
  emptyBatchDir,
  "empty batch params.path",
);

const deepSource = await makeSkill(
  tmp,
  "deep-source",
  "---\nname: deep-source\n---\nbody",
);
let deepPath = deepSource;
for (let i = 0; i < 65; i++) {
  deepPath = join(deepPath, `nested-${i}`);
  await mkdir(deepPath);
}
const deepImport = await importSkill(join(deepSource, "SKILL.md"), null);
ok(
  deepImport.ok === false,
  "import rejects sources that exceed the directory depth limit",
);
eq(
  deepImport.failed[0].code,
  "error.source.tooDeep",
  "too-deep import carries the code",
);
eq(
  deepImport.failed[0].params && deepImport.failed[0].params.depth,
  64,
  "too-deep params.depth",
);
const deepDry = await importSkill(join(deepSource, "SKILL.md"), null, {
  dryRun: true,
});
ok(
  deepDry.ok === false,
  "dry-run rejects sources that exceed the directory depth limit",
);
eq(
  deepDry.failed[0].code,
  "error.source.tooDeep",
  "too-deep dry-run carries the code",
);

await makeSkill(
  dshRoot,
  "invalid-policy",
  "---\nname: invalid-policy\ndescription: Invalid source invocation policy.\ndisable-model-invocation: maybe\n---\nbody",
);
const invalidPolicyEntries = await scanEntries(dshRoot);
eq(
  invalidPolicyEntries.entries.find((entry) => entry.name === "invalid-policy")
    .invocationPolicyValid,
  false,
  "scan marks invalid invocation policy values",
);
const invalidPolicySource = await readFile(
  join(dshRoot, "invalid-policy", "SKILL.md"),
  "utf8",
);
await selectMembers([member("dsh", "invalid-policy")]);
eq(
  await readFile(join(dshRoot, "invalid-policy", "SKILL.md"), "utf8"),
  invalidPolicySource,
  "enabling a Skill with invalid source invocation fields does not repair or rewrite the source",
);
const invalidPolicyOverlay = (await selectedCandidates()).find(
  (item) => item.source === "user-dsh" && item.name === "invalid-policy",
);
ok(
  invalidPolicyOverlay &&
    invalidPolicyOverlay.invocation.modelInvocable === false &&
    invalidPolicyOverlay.invocation.userInvocable === false,
  "session selection cannot override invalid source invocation fields",
);
await writeFile(
  join(dshRoot, "UPPER.MD"),
  "---\nname: upper\n---\nbody",
  "utf8",
);
const upperCaseEntries = await scanEntries(dshRoot);
ok(
  upperCaseEntries.entries.some((entry) => entry.name === "UPPER"),
  "scan recognizes uppercase Markdown extensions",
);

// 批量导入
const batchDir = join(tmp, "batch");
await mkdir(batchDir, { recursive: true });
await makeSkill(
  batchDir,
  "Alpha Beta",
  "---\nname: alpha-beta\ndescription: A.\n---\nbody",
);
await writeFile(
  join(batchDir, "gamma.md"),
  "---\nname: gamma\ndescription: G.\n---\nbody",
  "utf8",
);
const batch = await importSkill(batchDir, null);
eq(batch.imported.length, 2, "import batch dir");

// ── 斜杠菜单刷新通知 ──
{
  const events = [];
  let catalog = 0;
  notifyChatCatalog(
    {
      emit() {
        events.push(Array.from(arguments));
      },
      get(name) {
        if (name === "sessions")
          return {
            list() {
              return [{ id: "s1", header: { agentPreset: "web" } }];
            },
          };
      },
    },
    () => {
      catalog++;
    },
  );
  eq(catalog, 1, "notifyChatCatalog invalidates the host skill catalog");
  ok(
    events.some((event) => event[0] === "commands/change"),
    "notifyChatCatalog emits commands/change",
  );
  ok(
    events.some(
      (event) =>
        event[0] === "agent-preset/selected" &&
        event[1] === "s1" &&
        event[2] === "web",
    ),
    "notifyChatCatalog emits the live session preset",
  );
}

// ── Agent preset 作用域覆盖 ──
{
  const listeners = new Map();
  const invalidators = new Set();
  const registered = [];
  function agent(id) {
    return {
      id,
      ctx: {
        get(name) {
          if (name !== "skills") return undefined;
          return {
            registerProvider(create) {
              const lifecycle = new AbortController();
              const provider = create({
                signal: lifecycle.signal,
                invalidate() {},
              });
              registered.push({ id, provider });
              let live = true;
              return () => {
                if (!live) return;
                live = false;
                lifecycle.abort();
              };
            },
          };
        },
      },
    };
  }
  const existing = agent("existing");
  const later = agent("later");
  const dispose = registerAgentSkillProviders(
    {
      on(event, callback) {
        listeners.set(event, callback);
        return () => listeners.delete(event);
      },
      get(name) {
        if (name === "agents")
          return {
            list() {
              return [existing];
            },
          };
      },
    },
    invalidators,
  );
  eq(
    registered.length,
    1,
    "existing live agent receives an agent-scoped manager provider",
  );
  eq(
    registered[0].provider.name,
    "dsh-loadout-external",
    "agent-scoped provider keeps the manager provider identity",
  );
  eq(invalidators.size, 1, "agent-scoped provider contributes an invalidator");
  listeners.get("agent/created")({ agent: existing });
  eq(
    registered.length,
    1,
    "duplicate agent creation notification does not register twice",
  );
  listeners.get("agent/created")({ agent: later });
  eq(
    registered.length,
    2,
    "new live agent receives an agent-scoped manager provider",
  );
  listeners.get("agent/disposed")({ agent: existing });
  eq(invalidators.size, 1, "disposing an agent removes its scoped invalidator");
  dispose();
  eq(
    invalidators.size,
    0,
    "plugin teardown disposes all remaining scoped providers",
  );
  eq(listeners.size, 0, "plugin teardown removes agent lifecycle listeners");
}
// ── HTTP 路由 ──
await makeSkill(
  dshRoot,
  "http-skill",
  "---\nname: http-skill\ndescription: HTTP skill.\n---\nbody",
);
const concurrentImportSource = await makeSkill(
  tmp,
  "concurrent-import",
  "---\nname: concurrent-import\n---\nbody",
);
const routeProject = join(tmp, "route-project");
const routeProjectNested = join(routeProject, "packages", "app");
await mkdir(join(routeProject, ".git"), { recursive: true });
await mkdir(routeProjectNested, { recursive: true });
await makeSkill(
  join(routeProject, ".agents", "skills"),
  "route-project-skill",
  "---\nname: route-project-skill\ndescription: Project route skill.\n---\nProject route body",
);
await makeSkill(
  join(routeProject, ".dsh", "skills"),
  "route-project-dsh",
  "---\nname: route-project-dsh\ndescription: Project DSH route skill.\n---\nProject DSH route body",
);
let route;
let invalidated = 0;
const emitted = [];
let registeredTool = null;
applyHost({
  webServer: {
    register(value) {
      route = value;
      return function () {};
    },
  },
  webStartup: {
    trustedHosts: [
      "dsh.ere.lan",
      "dsh.fixed.lan:8443",
      "192.168.50.10",
      "attacker.example/path",
    ],
    host: "10.0.0.8",
    publicUrl: "https://public.dsh.lan:8443/app",
  },
  skills: {
    registerProvider(register) {
      register({
        invalidate() {
          invalidated++;
        },
      });
      return function () {};
    },
  },
  tools: {
    register(definition) {
      registeredTool = definition;
      return function () {};
    },
  },
  effect(register) {
    return register();
  },
  emit() {
    emitted.push(Array.from(arguments));
  },
  get(name) {
    if (name === "workspaceRegistry") return { list: () => [{ path: routeProjectNested }] };
    if (name === "sessions") {
      return {
        list() {
          return [
            {
              id: "sess-live",
              header: {
                id: "sess-live",
                agentPreset: "cordis",
                cwd: routeProjectNested,
              },
            },
            { id: "sess-blank", header: { id: "sess-blank" } },
          ];
        },
      };
    }
  },
});
const server = createServer((req, res) => route.handler(req, res));
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", reject);
    resolve();
  });
});
const address = server.address();
const api = `http://127.0.0.1:${address.port}/api/vlln/dsh-loadout`;
const secureHeaders = {
  "x-dsh-skills-session": "sess-live",
  "content-type": "application/json",
  "x-dsh-loadout": "1",
};
try {
  const stateResponse = await fetch(api + "/state", { headers: { "x-dsh-skills-session": "sess-live" } });
  eq(stateResponse.status, 200, "state route returns 200");
  const statePayload = await stateResponse.json();
  const httpProjectDshRoot = statePayload.data.roots.find(
    (root) => root.kind === "project-dsh" && root.projectRoot === routeProject,
  );
  const httpProjectRoot = statePayload.data.roots.find(
    (root) =>
      root.kind === "project-agents" && root.projectRoot === routeProject,
  );
  ok(
    httpProjectDshRoot && httpProjectDshRoot.mutable === true,
    "state route exposes an active Session project DSH root as writable even before its directory exists",
  );
  ok(
    httpProjectRoot &&
      httpProjectRoot.mutable === false &&
      httpProjectRoot.toggleable === true,
    "state route preserves read-only project Agent inventory metadata",
  );
  ok(
    httpProjectRoot.skills.some(
      (skill) => skill.name === "route-project-skill",
    ),
    "state route lists project-scoped skills from the Session cwd",
  );
  for (const sessionId of [undefined, "sess-blank", "missing"]) {
    const headers = sessionId ? { "x-dsh-skills-session": sessionId } : {};
    const payload = await (await fetch(api + "/state", { headers })).json();
    ok(payload.data.projects.length === 0 && payload.data.roots.every((root) => root.scope !== "project"), "absent, blank or unknown Session never exposes another project's skills");
    const result = await requestJson(api + "/detail", "POST", { ...secureHeaders, "x-dsh-skills-session": sessionId || "" }, JSON.stringify({ root: httpProjectRoot.key, name: "route-project-skill" }));
    ok(result.status >= 400, "another Session cannot use the old project root for details");
    const mutation = await requestJson(api + "/source-disable", "POST", { ...secureHeaders, "x-dsh-skills-session": sessionId || "" }, JSON.stringify({ root: httpProjectRoot.key }));
    ok(mutation.status >= 400, "another Session cannot change the old project source policy");
  }
  const projectDetailResponse = await requestJson(
    api + "/detail",
    "POST",
    secureHeaders,
    JSON.stringify({ root: httpProjectRoot.key, name: "route-project-skill" }),
  );
  eq(
    projectDetailResponse.status,
    200,
    "detail route accepts a live project root identity",
  );
  eq(
    projectDetailResponse.payload.data.body,
    "Project route body",
    "project detail returns the current project skill body",
  );
  const projectAgentSourceBeforeToggle = await readFile(
    join(routeProject, ".agents", "skills", "route-project-skill", "SKILL.md"),
    "utf8",
  );
  const projectToggleResponse = await requestJson(
    api + "/disable",
    "POST",
    secureHeaders,
    JSON.stringify({ root: httpProjectRoot.key, name: "route-project-skill" }),
  );
  eq(
    projectToggleResponse.status,
    400,
    "project Agent legacy disable is rejected",
  );
  ok(
    projectToggleResponse.payload.code === "error.policy.sessionOnly",
    "project Agent disable returns explicit migration error",
  );
  eq(
    await readFile(
      join(
        routeProject,
        ".agents",
        "skills",
        "route-project-skill",
        "SKILL.md",
      ),
      "utf8",
    ),
    projectAgentSourceBeforeToggle,
    "project Agent disable never rewrites the shared source file",
  );
  const defaultProjectState = await (await fetch(api + "/state", { headers: secureHeaders })).json();
  ok(defaultProjectState.data.roots.find(root => root.key === httpProjectRoot.key).skills.find(skill => skill.name === "route-project-skill").enabled, "rejected legacy disable leaves current project default available");
  const exclusionResponse = await requestJson(api + "/session-skill-exclusions", "POST", secureHeaders,
    JSON.stringify({ sessionId: "sess-live", excludedSkills: [member(httpProjectRoot.key, "route-project-skill")] }));
  eq(exclusionResponse.status, 200, "explicit session exclusion disables a project default");
  const disabledProjectState = await (await fetch(api + "/state", { headers: secureHeaders })).json();
  const disabledProjectAgent = disabledProjectState.data.roots
    .find((root) => root.key === httpProjectRoot.key)
    .skills.find((skill) => skill.name === "route-project-skill");
  ok(
    disabledProjectAgent.managerEnabled === false &&
      disabledProjectAgent.enabled === false,
    "state reports the explicitly excluded project Agent member as disabled",
  );
  let projectPolicyCandidates = await listProviderCandidates({
    sessionId: "sess-live", cwd: routeProjectNested,
  });
  const projectPolicyBlocker = projectPolicyCandidates.find(
    (item) =>
      item.source === "project-agents" && item.name === "route-project-skill",
  );
  ok(
    projectPolicyBlocker &&
      projectPolicyBlocker.rank === 199 &&
      projectPolicyBlocker.invocation.modelInvocable === false,
    "disabled project Agent skill contributes a policy blocker ahead of the official rank 200 candidate",
  );
  ok(
    projectPolicyBlocker &&
      typeof projectPolicyBlocker.locator.realEntryPath === "string" &&
      typeof projectPolicyBlocker.locator.realDocPath === "string",
    "project policy candidates retain their discovered real bundle and document paths",
  );
  eq(
    (await getProviderSkill(projectPolicyBlocker, { sessionId: "sess-live", cwd: routeProjectNested }))
      .content,
    "Project route body",
    "project policy blocker resolves only inside its current workspace",
  );
  const projectCandidateWithoutRealPath = {
    ...projectPolicyBlocker,
    locator: { ...projectPolicyBlocker.locator },
  };
  delete projectCandidateWithoutRealPath.locator.realDocPath;
  eq(
    await getProviderSkill(projectCandidateWithoutRealPath, {
      cwd: routeProjectNested,
    }),
    undefined,
    "provider rejects a project candidate missing a discovered real path",
  );
  eq(
    await getProviderSkill(projectPolicyBlocker, {
      cwd: join(tmp, "missing-workspace"),
    }),
    undefined,
    "project policy blocker cannot load through an unrelated workspace",
  );
  const projectAgentEnableResponse = await requestJson(
    api + "/enable",
    "POST",
    secureHeaders,
    JSON.stringify({ root: httpProjectRoot.key, name: "route-project-skill" }),
  );
  eq(
    projectAgentEnableResponse.status,
    400,
    "project Agent legacy enable is rejected",
  );
  eq(
    await readFile(
      join(
        routeProject,
        ".agents",
        "skills",
        "route-project-skill",
        "SKILL.md",
      ),
      "utf8",
    ),
    projectAgentSourceBeforeToggle,
    "project Agent enable also leaves the source file unchanged",
  );
  eq((await setSessionSkillExclusions("sess-live", [], undefined, { projectCwds: [routeProjectNested] })).excludedSkills?.length, 0, "clearing explicit exclusions restores project defaults");
  await selectMembers([member(httpProjectRoot.key, "route-project-skill")], { projectCwds: [routeProjectNested] }, "sess-live");
  projectPolicyCandidates = await listProviderCandidates({
    sessionId: "sess-live", cwd: routeProjectNested,
  });
  const projectEnableOverlay = projectPolicyCandidates.find(
    (item) =>
      item.source === "project-agents" && item.name === "route-project-skill",
  );
  ok(
    projectEnableOverlay &&
      projectEnableOverlay.rank === 199 &&
      projectEnableOverlay.invocation.modelInvocable === true,
    "explicit project Agent enable is enforced by a non-mutating policy overlay",
  );
  const validProjectManagerState = await readFile(managerStatePath(), "utf8");
  await writeFile(managerStatePath(), "{broken", "utf8");
  projectPolicyCandidates = await listProviderCandidates({
    cwd: routeProjectNested,
  });
  ok(
    projectPolicyCandidates.some(
      (item) =>
        item.source === "project-agents" &&
        item.name === "route-project-skill" &&
        item.invocation.modelInvocable === false,
    ),
    "invalid manager state fails closed for project Agent skills",
  );
  ok(
    projectPolicyCandidates.some(
      (item) =>
        item.source === "project-dsh" &&
        item.name === "route-project-dsh" &&
        item.invocation.modelInvocable === false,
    ),
    "invalid manager state fails closed for project DSH skills",
  );
  const rejectedProjectToggle = await requestJson(
    api + "/enable",
    "POST",
    secureHeaders,
    JSON.stringify({ root: httpProjectRoot.key, name: "route-project-skill" }),
  );
  eq(
    rejectedProjectToggle.status,
    400,
    "invalid manager state rejects project Agent toggle requests",
  );
  eq(
    rejectedProjectToggle.payload.code,
    "error.policy.sessionOnly",
    "retired project Agent toggles reject without overwriting invalid state",
  );
  eq(
    await readFile(managerStatePath(), "utf8"),
    "{broken",
    "rejected project Agent toggle preserves the invalid state file for recovery",
  );
  await writeFile(managerStatePath(), validProjectManagerState, "utf8");
  const projectCreateResponse = await requestJson(
    api + "/create",
    "POST",
    secureHeaders,
    JSON.stringify({
      root: httpProjectDshRoot.key,
      name: "Route Project Created",
      description: "Created through the project route.",
      body: "Project route creation body.",
    }),
  );
  eq(
    projectCreateResponse.status,
    200,
    "create route accepts an active Session project DSH root identity",
  );
  eq(
    projectCreateResponse.payload.data.root,
    httpProjectDshRoot.key,
    "project create returns the resolved project root identity",
  );
  ok(
    (await resolveEntry(
      join(routeProject, ".dsh", "skills"),
      "route-project-created",
    )) !== null,
    "project create persists under the active project's .dsh/skills root",
  );
  const projectDshSourceBeforeToggle = await readFile(
    join(routeProject, ".dsh", "skills", "route-project-created", "SKILL.md"),
    "utf8",
  );
  const projectDisableResponse = await requestJson(
    api + "/disable",
    "POST",
    secureHeaders,
    JSON.stringify({
      root: httpProjectDshRoot.key,
      name: "route-project-created",
    }),
  );
  eq(
    projectDisableResponse.status,
    400,
    "disable route rejects legacy project DSH policy",
  );
  eq(
    await readFile(
      join(routeProject, ".dsh", "skills", "route-project-created", "SKILL.md"),
      "utf8",
    ),
    projectDshSourceBeforeToggle,
    "project DSH disable leaves the source Skill file unchanged",
  );
  const projectDshDisableOverlay = (
    await listProviderCandidates({ cwd: routeProjectNested })
  ).find(
    (item) =>
      item.source === "project-dsh" && item.name === "route-project-created",
  );
  ok(
    projectDshDisableOverlay &&
      projectDshDisableOverlay.rank === 99 &&
      projectDshDisableOverlay.invocation.modelInvocable === false,
    "project DSH disable uses a rank 99 workspace policy overlay",
  );
  const projectEnableResponse = await requestJson(
    api + "/enable",
    "POST",
    secureHeaders,
    JSON.stringify({
      root: httpProjectDshRoot.key,
      name: "route-project-created",
    }),
  );
  eq(
    projectEnableResponse.status,
    400,
    "enable route rejects legacy project DSH policy",
  );
  eq(
    await readFile(
      join(routeProject, ".dsh", "skills", "route-project-created", "SKILL.md"),
      "utf8",
    ),
    projectDshSourceBeforeToggle,
    "project DSH enable also leaves the source Skill file unchanged",
  );
  await selectMembers([member(httpProjectDshRoot.key, "route-project-created")], { projectCwds: [routeProjectNested] }, "sess-live");
  const projectDshEnableOverlay = (
    await listProviderCandidates({ sessionId: "sess-live", cwd: routeProjectNested })
  ).find(
    (item) =>
      item.source === "project-dsh" && item.name === "route-project-created",
  );
  ok(
    projectDshEnableOverlay &&
      projectDshEnableOverlay.invocation.modelInvocable === true,
    "project DSH enable is enforced without rewriting source invocation fields",
  );
  const projectDeleteResponse = await requestJson(
    api + "/delete",
    "POST",
    secureHeaders,
    JSON.stringify({
      root: httpProjectDshRoot.key,
      name: "route-project-created",
    }),
  );
  eq(
    projectDeleteResponse.status,
    200,
    "delete route moves a project DSH skill to the shared Trash",
  );
  eq(
    projectDeleteResponse.payload.data.root.scope,
    "project",
    "project Trash metadata retains the original scope",
  );
  ok(
    (await resolveEntry(
      join(routeProject, ".dsh", "skills"),
      "route-project-created",
    )) === null,
    "project delete removes the live project entry",
  );
  const projectRestoreResponse = await requestJson(
    api + "/trash-restore",
    "POST",
    secureHeaders,
    JSON.stringify({ id: projectDeleteResponse.payload.data.id }),
  );
  eq(
    projectRestoreResponse.status,
    200,
    "Trash restore returns a project Skill to its active project",
  );
  ok(
    (await resolveEntry(
      join(routeProject, ".dsh", "skills"),
      "route-project-created",
    )) !== null,
    "project restore recreates the original project entry",
  );
  const projectAgentDeleteResponse = await requestJson(
    api + "/delete",
    "POST",
    secureHeaders,
    JSON.stringify({ root: httpProjectRoot.key, name: "route-project-skill" }),
  );
  eq(
    projectAgentDeleteResponse.status,
    400,
    "delete route keeps project .agents/skills read-only",
  );
  eq(
    projectAgentDeleteResponse.payload.code,
    "error.root.readonly",
    "project Agent deletion uses the readonly error contract",
  );
  const staleProjectCreateResponse = await requestJson(
    api + "/create",
    "POST",
    secureHeaders,
    JSON.stringify({
      root: "project-dsh:stale",
      name: "Must Not Fall Back",
      description: "Must be rejected.",
      body: "Denied.",
    }),
  );
  eq(
    staleProjectCreateResponse.status,
    400,
    "create route rejects a stale or forged project root identity",
  );
  ok(
    (await resolveEntry(dshRoot, "must-not-fall-back")) === null,
    "rejected project creation never falls back to the user DSH root",
  );
  const headState = await fetch(api + "/state", { method: "HEAD" });
  eq(headState.status, 200, "HEAD /state returns 200");
  eq(await headState.text(), "", "HEAD /state has an empty body");
  const stateGet = await fetch(api + "/state");
  eq(
    headState.headers.get("content-length"),
    stateGet.headers.get("content-length"),
    "HEAD /state content-length matches the GET entity",
  );
  const headDisable = await fetch(api + "/disable", { method: "HEAD" });
  eq(headDisable.status, 405, "HEAD on a mutation route returns 405");
  eq(await headDisable.text(), "", "HEAD 405 has an empty body");
  eq(
    headDisable.headers.get("content-length"),
    String(
      Buffer.byteLength(
        JSON.stringify({
          ok: false,
          code: "error.proto.method",
          error: "method not allowed: HEAD",
        }),
      ),
      "utf8",
    ),
    "HEAD 405 content-length matches the POST 405 payload shape",
  );

  const localhostStateResponse = await requestJson(api + "/state", "GET", {
    host: "localhost:" + address.port,
  });
  eq(
    localhostStateResponse.status,
    200,
    "state route accepts localhost Host headers",
  );
  ok(
    localhostStateResponse.payload.ok === true,
    "loopback GET /state still returns the snapshot",
  );

  const loopbackRangeResponse = await requestJson(api + "/state", "GET", {
    host: "127.23.45.67:" + address.port,
  });
  eq(
    loopbackRangeResponse.status,
    200,
    "state route accepts the full IPv4 127/8 loopback range like the DSH trust fence",
  );

  const foreignOriginResponse = await requestJson(api + "/disable", "POST", {
    ...secureHeaders,
    host: "localhost:" + address.port,
    origin: "https://evil.example",
  }, JSON.stringify({ name: "http-skill" }));
  eq(
    foreignOriginResponse.status,
    403,
    "foreign Origin requests are rejected",
  );
  eq(
    foreignOriginResponse.payload.code,
    "error.proto.forbidden",
    "foreign Origin carries the forbidden code",
  );

  const trustedMissingMarkerResponse = await requestJson(
    api + "/enable",
    "POST",
    { "content-type": "application/json", host: "dsh.ere.lan" },
    JSON.stringify({ name: "http-skill" }),
  );
  eq(
    trustedMissingMarkerResponse.status,
    403,
    "trusted hosts do not bypass the mutation client marker",
  );
  eq(
    trustedMissingMarkerResponse.payload.code,
    "error.proto.forbidden",
    "trusted mutation without a marker keeps the forbidden request code",
  );

  const localhostHostResponse = await requestJson(
    api + "/enable",
    "POST",
    { ...secureHeaders, host: "localhost:" + address.port },
    JSON.stringify({ name: "http-skill" }),
  );
  eq(
    localhostHostResponse.status,
    400,
    "localhost passes host fence and reaches retired-policy rejection",
  );

  const uploadResponse = await requestJson(
    api + "/upload",
    "POST",
    secureHeaders,
    JSON.stringify({
      name: "SKILL.md",
      entries: [
        {
          path: "SKILL.md",
          data: Buffer.from(
            "---\nname: http-upload\ndescription: HTTP upload.\n---\nbody",
          ).toString("base64"),
        },
      ],
    }),
  );
  eq(
    uploadResponse.status,
    200,
    "upload route accepts browser-read skill content",
  );
  eq(
    uploadResponse.payload.data.imported[0].name,
    "http-upload",
    "upload route returns the imported skill",
  );
  ok(
    (await resolveEntry(dshRoot, "http-upload")) !== null,
    "upload route persists the skill through the normal import path",
  );

  const largeUploadEntries = [
    {
      path: "http-large-upload/SKILL.md",
      data: Buffer.from(
        "---\nname: http-large-upload\ndescription: Large HTTP upload.\n---\nbody",
      ).toString("base64"),
    },
  ].concat(
    [7, 10, 10].map((mib, index) => ({
      path: `http-large-upload/assets/part-${index}.bin`,
      data: Buffer.alloc(mib << 20, index + 1).toString("base64"),
    })),
  );
  const largeUploadBody = JSON.stringify({
    name: "http-large-upload",
    entries: largeUploadEntries,
  });
  ok(
    Buffer.byteLength(largeUploadBody) > 36 << 20,
    "large upload regression exceeds the former 36 MiB request limit",
  );
  const largeUploadResponse = await requestJson(
    api + "/upload",
    "POST",
    secureHeaders,
    largeUploadBody,
  );
  eq(
    largeUploadResponse.status,
    200,
    "upload route accepts a 27 MiB folder above the former total and Base64 JSON ceilings",
  );
  eq(
    largeUploadResponse.payload.data.imported[0].name,
    "http-large-upload",
    "large browser upload reaches the normal import path",
  );
  ok(
    (await resolveEntry(dshRoot, "http-large-upload")) !== null,
    "large browser upload persists the skill",
  );

  const csrfResponse = await fetch(api + "/disable", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "http-skill" }),
  });
  eq(
    csrfResponse.status,
    403,
    "mutating route rejects requests without the client marker",
  );
  eq(
    (await csrfResponse.json()).code,
    "error.proto.forbidden",
    "403 response carries the protocol error code",
  );

  const contentTypeResponse = await fetch(api + "/disable", {
    method: "POST",
    headers: { "x-dsh-loadout": "1" },
    body: JSON.stringify({ name: "http-skill" }),
  });
  eq(
    contentTypeResponse.status,
    415,
    "mutating route requires JSON content type",
  );
  eq(
    (await contentTypeResponse.json()).code,
    "error.proto.contentType",
    "415 response carries the protocol error code",
  );

  const methodResponse = await fetch(api + "/disable", { method: "PUT" });
  eq(methodResponse.status, 405, "unsupported method returns 405");
  eq(
    (await methodResponse.json()).code,
    "error.proto.method",
    "405 response carries the protocol error code",
  );

  const invalidJsonResponse = await fetch(api + "/disable", {
    method: "POST",
    headers: secureHeaders,
    body: "{",
  });
  eq(invalidJsonResponse.status, 400, "invalid JSON returns 400");

  let oversizedStatus = 0;
  try {
    const oversizedResponse = await fetch(api + "/disable", {
      method: "POST",
      headers: secureHeaders,
      body: JSON.stringify({
        name: "http-skill",
        padding: "x".repeat(1 << 20),
      }),
    });
    oversizedStatus = oversizedResponse.status;
  } catch {
    oversizedStatus = -1;
  }
  eq(
    oversizedStatus,
    413,
    "oversized JSON returns 413 without dropping the response",
  );

  const httpSkillSourceBeforeToggle = await readFile(
    join(dshRoot, "http-skill", "SKILL.md"),
    "utf8",
  );
  const disableResponse = await fetch(api + "/disable", {
    method: "POST",
    headers: secureHeaders,
    body: JSON.stringify({ name: "http-skill" }),
  });
  eq(disableResponse.status, 400, "valid legacy mutation receives migration rejection");
  eq((await disableResponse.json()).code, "error.policy.sessionOnly", "HTTP disable explicitly rejects retired policy");
  const httpSelection = await selectMembers([member("dsh", "http-skill")]);
  const beforeSelectionInvalidation = invalidated;
  const selectedResponse = await requestJson(api + "/session-loadout", "POST", secureHeaders, JSON.stringify({ sessionId: "sess-live", loadoutId: httpSelection.id }));
  eq(selectedResponse.status, 200, "session selection route succeeds");
  ok(invalidated > beforeSelectionInvalidation, "session selection invalidates providers");
  eq(
    await readFile(join(dshRoot, "http-skill", "SKILL.md"), "utf8"),
    httpSkillSourceBeforeToggle,
    "HTTP disable stores policy without rewriting the user DSH Skill",
  );
  ok(invalidated > 0, "successful mutation invalidates the skill catalog");
  ok(
    emitted.some((event) => event[0] === "commands/change"),
    "successful mutation notifies the command catalog",
  );
  ok(
    emitted.some(
      (event) =>
        event[0] === "agent-preset/selected" &&
        event[1] === "sess-live" &&
        event[2] === "cordis",
    ),
    "successful mutation refreshes live session slash menus",
  );
  ok(
    !emitted.some(
      (event) =>
        event[0] === "agent-preset/selected" && event[1] === "sess-blank",
    ),
    "sessions without a preset are not rewritten",
  );

  const publicResponse = await fetch(api + "/disable", {
    method: "POST",
    headers: secureHeaders,
    body: JSON.stringify({ name: "public-skill", root: "agents" }),
  });
  eq(
    publicResponse.status,
    400,
    "HTTP route rejects public Agent legacy toggles",
  );
  const publicPayload = await publicResponse.json();
  ok(
    publicPayload.ok === false && publicPayload.code === "error.policy.sessionOnly",
    "HTTP public toggle returns migration error",
  );
  const httpDeleteAgents = await fetch(api + "/delete", {
    method: "POST",
    headers: secureHeaders,
    body: JSON.stringify({ name: "http-skill", root: "agents" }),
  });
  eq(httpDeleteAgents.status, 400, "Shared Agent 中不存在的技能返回失败");
  eq(
    (await httpDeleteAgents.json()).code,
    "error.skill.notFound",
    "Shared Agent 中不存在的技能不再误报只读",
  );
  ok(
    (await resolveEntry(dshRoot, "http-skill")) !== null,
    "HTTP delete with agents root does not remove the DSH skill",
  );
  const httpDotDelete = await fetch(api + "/delete", {
    method: "POST",
    headers: secureHeaders,
    body: JSON.stringify({ name: "." }),
  });
  eq(
    httpDotDelete.status,
    400,
    "HTTP delete rejects current-directory traversal",
  );
  const httpNestedDelete = await fetch(api + "/delete", {
    method: "POST",
    headers: secureHeaders,
    body: JSON.stringify({ name: "foo/../safe-bar" }),
  });
  eq(httpNestedDelete.status, 400, "HTTP delete rejects nested traversal");
  ok(
    (await resolveEntry(dshRoot, "safe-bar")) !== null,
    "HTTP traversal deletes leave skills unchanged",
  );
  const unknownResponse = await fetch(api + "/unknown", {
    method: "POST",
    headers: secureHeaders,
    body: "{}",
  });
  eq(unknownResponse.status, 404, "unknown mutation route returns 404");
  eq(
    (await unknownResponse.json()).code,
    "error.proto.unknownAction",
    "404 response carries the protocol error code",
  );

  const concurrentResponses = await Promise.all(
    [1, 2].map(function () {
      return fetch(api + "/import", {
        method: "POST",
        headers: secureHeaders,
        body: JSON.stringify({ source: concurrentImportSource }),
      }).then(function (response) {
        return response.json();
      });
    }),
  );
  eq(
    concurrentResponses.reduce(function (count, payload) {
      return count + payload.data.imported.length;
    }, 0),
    1,
    "concurrent imports perform one installation",
  );
  eq(
    concurrentResponses.reduce(function (count, payload) {
      return count + payload.data.skipped.length;
    }, 0),
    1,
    "concurrent imports serialize the second conflict check",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

// ── 状态快照 ──
const snap = await state();
eq(
  snap.roots.length,
  23,
  "state returns DSH, CC Switch, Copilot, Cursor, first-tier Agents, WorkBuddy, Qoder, and common Agent roots",
);
ok(
  snap.roots.some((root) => root.key === "antigravity"),
  "state includes Google Antigravity source",
);
ok(
  snap.roots.some((root) => root.key === "ccswitch"),
  "state includes the CC Switch source",
);
ok(
  snap.roots.some(
    (root) =>
      root.key === "cursor" &&
      root.skills.some((skill) => skill.name === "cursor-review"),
  ),
  "state includes the Cursor source and its Skills",
);
const dshSnap = snap.roots.find((r) => r.key === "dsh");
ok(dshSnap.mutable === true, "DSH root allows destructive actions");
ok(
  dshSnap.skills.some((s) => s.name === "import-me"),
  "state lists imported skill",
);
ok(
  dshSnap.skills.find((s) => s.name === "import-me").modelInvocable === true,
  "state modelInvocable",
);
const invalidPolicySnap = dshSnap.skills.find(
  (s) => s.name === "invalid-policy",
);
ok(
  invalidPolicySnap.hasFrontmatter === true,
  "state preserves hasFrontmatter for invalid source invocation policy",
);
ok(
  invalidPolicySnap.invocationPolicyValid === false,
  "state preserves invalid invocation policy status",
);
ok(
  invalidPolicySnap.loadable === true,
  "inventory retains structural loadability separately from invalid invocation policy",
);
const agentsSnap = snap.roots.find((r) => r.key === "agents");
ok(
  agentsSnap.mutable === true,
  "公共 Agent 根开放普通文件管理",
);
ok(
  agentsSnap.skills.some((s) => s.name === "public-skill"),
  "state lists public Agent skill",
);
ok(
  hostInject.includes("sessions"),
  "host declares the Session service used for project workspace discovery",
);
eq(
  activeSessionCwds({
    sessions: {
      list: () => [
        { id: "first", header: { cwd: routeProjectNested } },
        { id: "second", header: { cwd: "/other" } },
        { header: {} },
      ],
    },
  }, "first").length,
  1,
  "activeSessionCwds only resolves the selected Session",
);

// ── 项目级 Skill：按 workspace 隔离、遵循官方优先级、每次请求重新发现 ──
const noGitWorkspace = join(tmp, "no-git-workspace");
await mkdir(noGitWorkspace, { recursive: true });
eq(
  (await projectRoots([noGitWorkspace])).length,
  1,
  "projectRoots falls back to a readable cwd without a .git ancestor",
);
const secondProject = join(tmp, "second-project");
await mkdir(join(secondProject, ".git"), { recursive: true });
await makeSkill(
  join(routeProject, ".dsh", "skills"),
  "project-priority",
  "---\nname: project-priority\ndescription: Project DSH winner.\n---\nDSH winner",
);
await makeSkill(
  join(routeProject, ".agents", "skills"),
  "project-priority",
  "---\nname: project-priority\ndescription: Project Agent loser.\n---\nAgent loser",
);
await makeSkill(
  join(secondProject, ".agents", "skills"),
  "project-priority",
  "---\nname: project-priority\ndescription: Independent workspace winner.\n---\nSecond project",
);
const resolvedProjectRoots = await projectRoots([
  routeProjectNested,
  routeProject,
  secondProject,
  "relative/path",
]);
eq(
  resolvedProjectRoots.length,
  4,
  "projectRoots deduplicates Sessions by nearest git root and ignores non-absolute cwd values",
);
eq(
  new Set(resolvedProjectRoots.map((root) => root.key)).size,
  4,
  "project source keys stay unique across workspaces and source kinds",
);
const writableProjectDefinition = resolvedProjectRoots.find(
  (root) => root.kind === "project-dsh" && root.projectRoot === routeProject,
);
const readonlyProjectDefinition = resolvedProjectRoots.find(
  (root) => root.kind === "project-agents" && root.projectRoot === routeProject,
);
ok(
  writableProjectDefinition.mutable === true &&
    writableProjectDefinition.toggleable === true,
  "project DSH roots expose writable inventory and legacy capability metadata",
);
ok(
  readonlyProjectDefinition.mutable === false &&
    readonlyProjectDefinition.toggleable === true,
  "project Agent roots keep source files read-only and retain legacy metadata",
);
const directProjectCreated = await createSkill(
  {
    name: "Direct Project Created",
    description: "Direct project create.",
    body: "Direct project body.",
  },
  null,
  { root: writableProjectDefinition },
);
eq(
  directProjectCreated.root,
  writableProjectDefinition.key,
  "createSkill accepts a validated active project DSH definition",
);
ok(
  (await resolveEntry(
    writableProjectDefinition.path,
    "direct-project-created",
  )) !== null,
  "direct project creation writes to .dsh/skills",
);
eq(
  (
    await createSkill(
      { name: "Denied Project Agent", description: "Denied.", body: "Denied." },
      null,
      { root: readonlyProjectDefinition },
    )
  ).code,
  "error.root.readonly",
  "createSkill rejects project .agents/skills",
);
eq(
  (
    await createSkill(
      { name: "Forged Root", description: "Denied.", body: "Denied." },
      null,
      { root: { key: "dsh", path: join(tmp, "forged"), mutable: true } },
    )
  ).code,
  "error.root.readonly",
  "createSkill rejects a forged mutable DSH root object",
);
const directProjectDeleted = await deleteSkill(
  writableProjectDefinition,
  "direct-project-created",
);
eq(
  directProjectDeleted.root.key,
  writableProjectDefinition.key,
  "deleteSkill stores the original project root identity in Trash",
);
eq(
  (await restoreTrash(directProjectDeleted.id, null, { projectCwds: [] })).code,
  "error.workspace.unregistered",
  "project restore passes through an unregistered workspace instead of the old session error",
);
eq(
  (await restoreTrash(directProjectDeleted.id, null, { projectCwds: [], registeredWorkspaces: [routeProjectNested] })).code,
  "error.trash.projectUnavailable",
  "project restore refuses a registered project that is not in the active session",
);
const directProjectRestored = await restoreTrash(
  directProjectDeleted.id,
  null,
  { registeredWorkspaces: [routeProjectNested] },
);
eq(
  directProjectRestored.root.key,
  writableProjectDefinition.key,
  "project restore resolves the original root from real registered paths",
);
ok(
  (await resolveEntry(
    writableProjectDefinition.path,
    "direct-project-created",
  )) !== null,
  "project restore returns the complete bundle to its original root",
);
eq(
  (await deleteSkill(readonlyProjectDefinition, "project-priority")).code,
  "error.root.readonly",
  "deleteSkill keeps project .agents/skills read-only",
);
await selectMembers([member(writableProjectDefinition.key, "project-priority"), member(readonlyProjectDefinition.key, "project-priority"), member(resolvedProjectRoots.find(root => root.kind === "project-agents" && root.projectRoot === secondProject).key, "project-priority")], { projectCwds: [routeProjectNested, secondProject] });
const projectSnap = await selectedState({
  projectCwds: [routeProjectNested, secondProject],
});
const firstDshProject = projectSnap.roots.find(
  (root) => root.kind === "project-dsh" && root.projectRoot === routeProject,
);
const firstAgentsProject = projectSnap.roots.find(
  (root) => root.kind === "project-agents" && root.projectRoot === routeProject,
);
const secondProjectSnap = await selectedState({ projectCwds: [secondProject] });
const secondAgentsProject = secondProjectSnap.roots.find(
  (root) =>
    root.kind === "project-agents" && root.projectRoot === secondProject,
);
ok(
  firstDshProject &&
    firstDshProject.scope === "project" &&
    firstDshProject.mutable === true &&
    firstDshProject.toggleable === true,
  "project DSH inventory exposes create/delete and legacy capability metadata",
);
eq(
  firstDshProject.rank,
  100,
  "project state exposes the official project-dsh rank",
);
eq(
  firstAgentsProject.rank,
  200,
  "project state exposes the official project-agents rank",
);
ok(
  firstAgentsProject.skills.find((skill) => skill.name === "project-priority")
    .shadowedBy.root === firstDshProject.key,
  "project DSH rank 100 shadows project Agent rank 200 within one workspace",
);
ok(
  firstDshProject.skills.find((skill) => skill.name === "project-priority")
    .enabled === true,
  "the higher-priority project skill reports invocation policy as enabled without claiming body loading",
);
ok(
  secondAgentsProject.skills.find((skill) => skill.name === "project-priority")
    .enabled === true,
  "same-named skills in another workspace report their independent invocation policy",
);
ok(
  firstDshProject.skills.find((skill) => skill.name === "project-priority")
    .enabled === true &&
    secondAgentsProject.skills.find((skill) => skill.name === "project-priority")
      .enabled === true,
  "independently enabled project winners keep their own invocation policy",
);
const projectDetail = await skillDetail(
  firstDshProject.key,
  "project-priority",
  { projectCwds: [routeProjectNested] },
);
eq(
  projectDetail.body,
  "DSH winner",
  "skillDetail resolves only live Session-derived project root identities",
);
eq(
  (
    await skillDetail(firstDshProject.key, "project-priority", {
      projectCwds: [secondProject],
    })
  ).code,
  "error.root.unknown",
  "stale project identities cannot read a workspace no longer present in active Sessions",
);
await writeFile(
  join(routeProject, ".dsh", "skills", "project-priority", "SKILL.md"),
  "---\nname: project-priority\ndescription: Refreshed.\n---\nFresh body",
  "utf8",
);
eq(
  (
    await skillDetail(firstDshProject.key, "project-priority", {
      projectCwds: [routeProjectNested],
    })
  ).body,
  "Fresh body",
  "project detail re-reads modified files instead of caching bodies",
);
await rm(join(routeProject, ".dsh", "skills", "project-priority"), {
  recursive: true,
  force: true,
});
const removedProjectSnap = await state({ projectCwds: [routeProjectNested] });
ok(
  !removedProjectSnap.roots
    .find((root) => root.key === firstDshProject.key)
    .skills.some((skill) => skill.name === "project-priority"),
  "a removed project skill disappears on the next state snapshot",
);
const outsideProjectSkill = await makeSkill(
  join(tmp, "outside-project-skills"),
  "linked-project",
  "---\nname: linked-project\ndescription: Outside project link.\n---\nOutside",
);
const projectLinkType = process.platform === "win32" ? "junction" : undefined;
if (
  await tryLink(
    outsideProjectSkill,
    join(routeProject, ".agents", "skills", "linked-project"),
    projectLinkType,
  )
) {
  const linkedProjectSnap = await state({ projectCwds: [routeProjectNested] });
  ok(
    linkedProjectSnap.roots
      .find((root) => root.key === firstAgentsProject.key)
      .skills.some((skill) => skill.name === "linked-project"),
    "项目 Agent 跟随外部技能目录链接",
  );
} else {
  ok(
    true,
    "project linked-bundle containment test skipped because this environment cannot create links",
  );
}
const linkedCcSwitchProjectSkill = join(
  routeProject,
  ".agents",
  "skills",
  "linked-ccswitch-project",
);
if (await tryLink(ccswitchSkill, linkedCcSwitchProjectSkill, projectLinkType)) {
  const linkedCcSwitchProjectSnap = await state({
    projectCwds: [routeProjectNested],
  });
  ok(
    linkedCcSwitchProjectSnap.roots.flatMap(root => root.skills).filter(skill => skill.canonicalName === "ccswitch-shared").length === 1 &&
      linkedCcSwitchProjectSnap.roots.find(root => root.key === "ccswitch").skills.some(skill => skill.name === "ccswitch-shared"),
    "project distribution link deduplicates to its canonical CC Switch inventory owner",
  );
  await rm(linkedCcSwitchProjectSkill, { recursive: true, force: true });
} else {
  ok(
    true,
    "project trusted-target link test skipped because this environment cannot create directory links",
  );
}
const unsafeProject = join(tmp, "unsafe-project");
const unsafeProjectTarget = join(tmp, "unsafe-project-target");
await mkdir(join(unsafeProject, ".git"), { recursive: true });
await mkdir(join(unsafeProject, ".dsh"), { recursive: true });
await makeSkill(
  unsafeProjectTarget,
  "outside-project-write",
  "---\nname: outside-project-write\ndescription: Must stay outside.\n---\nOutside",
);
const unsafeDefinition = (await projectRoots([unsafeProject])).find(
  (root) => root.kind === "project-dsh",
);
if (
  await tryLink(
    unsafeProjectTarget,
    join(unsafeProject, ".dsh", "skills"),
    projectLinkType,
  )
) {
  ok(
    !(await projectRoots([unsafeProject])).some(
      (root) => root.kind === "project-dsh",
    ),
    "project discovery hides a linked .dsh/skills root",
  );
  ok(
    !(await state({ projectCwds: [unsafeProject] })).roots.some(
      (root) =>
        root.kind === "project-dsh" && root.projectRoot === unsafeProject,
    ),
    "state does not expose a linked project DSH root",
  );
  eq(
    (await scanEntries(join(unsafeProject, ".dsh", "skills"))).entries.length,
    0,
    "scanEntries does not follow a linked skill root",
  );
  eq(
    await resolveEntry(
      join(unsafeProject, ".dsh", "skills"),
      "outside-project-write",
    ),
    null,
    "resolveEntry does not follow a linked skill root",
  );
  eq(
    (
      await skillDetail(unsafeDefinition.key, "outside-project-write", {
        projectCwds: [unsafeProject],
      })
    ).code,
    "error.root.unknown",
    "project detail cannot read through a linked skill root",
  );
  eq(
    (
      await createSkill(
        {
          name: "Escaped Create",
          description: "Must not escape.",
          body: "Denied.",
        },
        null,
        { root: unsafeDefinition },
      )
    ).code,
    "error.root.unsafe",
    "project create refuses a linked .dsh/skills root",
  );
  eq(
    (await setSkillEnabled(unsafeDefinition, "outside-project-write", false))
      .code,
    "error.policy.sessionOnly",
    "retired project toggle rejects before following linked root",
  );
  eq(
    (await deleteSkill(unsafeDefinition, "outside-project-write")).code,
    "error.root.unsafe",
    "project delete refuses a linked .dsh/skills root",
  );
  ok(
    (await resolveEntry(unsafeProjectTarget, "outside-project-write")) !== null,
    "unsafe project mutations leave the linked external target unchanged",
  );
} else {
  ok(
    true,
    "project mutation root-link test skipped because this environment cannot create links",
  );
}
const overlapProject = join(tmp, "overlap-project");
await mkdir(join(overlapProject, ".git"), { recursive: true });
await mkdir(join(overlapProject, ".agents", "skills", "overlap-shared"), {
  recursive: true,
});
await writeFile(
  join(overlapProject, ".agents", "skills", "overlap-shared", "SKILL.md"),
  "---\nname: overlap-shared\ndescription: 重叠回归\n---\n共享正文",
  "utf8",
);
const overlapDefinition = (await projectRoots([overlapProject])).find(
  (root) => root.kind === "project-dsh",
);
const overlapAgentDefinition = (await projectRoots([overlapProject])).find(
  (root) => root.kind === "project-agents",
);
ok(overlapAgentDefinition, "存在的项目 Agent 来源可先解析再被重叠隐藏");
const originalDshHome = process.env.DSH_HOME;
const originalAgentsHome = process.env.DSH_AGENTS_HOME;
process.env.DSH_HOME = join(overlapProject, ".dsh");
process.env.DSH_AGENTS_HOME = join(overlapProject, ".agents");
try {
  const overlapRoots = await projectRoots([overlapProject]);
  eq(overlapRoots.length, 0, "真实存在的用户根与项目根重叠时隐藏项目来源");
  await setSkillEnabled(
    join(overlapProject, ".agents", "skills"),
    "overlap-shared",
    false,
  );
  const overlapCandidates = (
    await listProviderCandidates({ cwd: overlapProject })
  ).filter((entry) => entry.name === "overlap-shared");
  ok(
    overlapCandidates.length > 0 &&
      overlapCandidates.every(
        (entry) =>
          !entry.invocation.modelInvocable && !entry.invocation.userInvocable,
      ),
    "重叠项目来源不能绕过用户技能停用",
  );
  eq(
    (await createLoadout("Unsafe overlap", null, [member(overlapAgentDefinition.key, "overlap-shared")], undefined, { projectCwds: [overlapProject] }))
      .code,
    "error.loadout.globalOnly",
    "拒绝项目成员，无论旧来源是否因重叠而失效",
  );
  eq(
    (await state({ projectCwds: [overlapProject] })).roots.filter(
      (root) => root.scope === "project",
    ).length,
    0,
    "state exposes only the user roots when a dotfiles project overlaps them",
  );
  eq(
    (
      await createSkill(
        {
          name: "Overlap Write",
          description: "Must not write.",
          body: "Denied.",
        },
        null,
        { root: overlapDefinition },
      )
    ).code,
    "error.root.unsafe",
    "write validation rejects a previously resolved project root after it overlaps the user DSH root",
  );
} finally {
  process.env.DSH_HOME = originalDshHome;
  process.env.DSH_AGENTS_HOME = originalAgentsHome;
}
const missingProjectSnap = await state({
  projectCwds: [join(tmp, "missing-workspace")],
});
const missingWarning = missingProjectSnap.warnings.find(
  (warning) => warning.code === "warning.project.missing",
);
ok(missingWarning, "missing active workspaces produce warning.project.missing");
eq(
  missingWarning.params.path,
  join(tmp, "missing-workspace"),
  "missing active workspace warning preserves path parameter",
);
eq(
  missingWarning.params.code,
  "ENOENT",
  "missing active workspace warning preserves ENOENT error code",
);

// 验证 EACCES 权限错误端到端派发 warning.project.unreadable
const originRealpath = fs.realpath;
fs.realpath = async (p) => {
  if (String(p).includes("eacces-workspace")) {
    const err = new Error("permission denied");
    err.code = "EACCES";
    throw err;
  }
  return originRealpath(p);
};
try {
  const unreadableSnap = await state({
    projectCwds: [join(tmp, "eacces-workspace")],
  });
  const unreadableWarning = unreadableSnap.warnings.find(
    (w) => w.code === "warning.project.unreadable",
  );
  ok(unreadableWarning, "EACCES active workspace produces warning.project.unreadable");
  eq(unreadableWarning.params.code, "EACCES", "unreadable warning preserves EACCES error code");
} finally {
  fs.realpath = originRealpath;
}
ok(
  registeredTool && registeredTool.name === "create_skill",
  "host registers the conversational create_skill tool",
);
eq(
  registeredTool.output.render(null, { ok: false, code: "error.skill.exists", error: "技能已存在: foo", params: { name: "foo" } })[0].text.includes("技能"),
  false,
  "create_skill failure card must not embed the Chinese error text",
);

// 同名候选必须经过上游真实的层内排序与跨层合并，单测候选数量无法证明运行时来源正确。
async function mergedSkillCandidate(
  name,
  globalCandidates,
  presetCandidates,
  managerCandidates,
) {
  const rows = (candidates) =>
    candidates.map((candidate, localOrder) => ({
      candidate,
      providerOrder: 0,
      localOrder,
    }));
  const registry = {
    layers: {
      global: rows(globalCandidates),
      chainLayers: () => [rows(presetCandidates), rows(managerCandidates)],
    },
    ctx: { logger: { warn() {} } },
    listLayerCandidates: async (entries) => ({
      entries: [...entries],
      cacheable: true,
    }),
    collectLayer: SkillRegistry.prototype.collectLayer,
  };
  const result = await SkillRegistry.prototype.collectFresh.call(registry, {});
  return result.entries.get(name)?.candidate;
}

const duplicateName = "issue-nine";
const duplicateDoc = (body) =>
  `---\nname: ${duplicateName}\ndescription: 同名技能回归。\n---\n${body}`;
await makeSkill(dshRoot, "issue-nine-local", duplicateDoc("DSH 正文"));
await makeSkill(codexRoot, "issue-nine-codex", duplicateDoc("Codex 正文"));
const duplicatePolicyBefore = await readFile(managerStatePath(), "utf8");
const nativeDshCandidate = {
  name: duplicateName,
  source: "user-dsh",
  rank: 400,
  invocation: { modelInvocable: true, userInvocable: true },
};
const nativeAgentsCandidate = {
  ...nativeDshCandidate,
  source: "user-agents",
  rank: 450,
};
try {
  await selectMembers([member("dsh", "issue-nine-local")]);
  const codexOnlyCandidates = (await selectedCandidates()).filter(
    (candidate) => candidate.name === duplicateName,
  );
  const mergedCodexOnly = await mergedSkillCandidate(
    duplicateName,
    [nativeDshCandidate],
    [],
    codexOnlyCandidates,
  );
  eq(
    mergedCodexOnly?.source,
    "user-dsh",
    "议题最小场景：未选 Codex 副本不能遮蔽会话选中的 DSH",
  );
  ok(
    mergedCodexOnly?.invocation.modelInvocable &&
      mergedCodexOnly?.invocation.userInvocable,
    "议题最小场景：会话选中的 DSH 保持双通道可调用",
  );
  await makeSkill(
    agentsRoot,
    "issue-nine-agents",
    duplicateDoc("公共 Agent 正文"),
  );
  await selectMembers([member("dsh", "issue-nine-local"), member("agents", "issue-nine-agents"), member("codex", "issue-nine-codex")]);
  const duplicateState = await selectedState();
  const localWinner = duplicateState.roots
    .find((root) => root.key === "dsh")
    .skills.find((skill) => skill.declaredName === duplicateName);
  ok(
    localWinner.winner && localWinner.enabled,
    "全部副本被选时管理页以 DSH 为优先赢家",
  );
  const duplicateCandidates = (await selectedCandidates()).filter(
    (candidate) => candidate.name === duplicateName,
  );
  eq(
    duplicateCandidates.length,
    1,
    "不同目录名但声明名相同的用户条目只输出一个赢家",
  );
  eq(
    duplicateCandidates[0]?.source,
    "user-dsh",
    "显式所选 DSH 冲突赢家提供会话候选",
  );
  const mergedDuplicate = await mergedSkillCandidate(
    duplicateName,
    [nativeDshCandidate],
    [nativeAgentsCandidate],
    duplicateCandidates,
  );
  eq(
    mergedDuplicate?.source,
    "user-dsh",
    "低优先级所选副本及预设候选不能遮蔽 DSH 赢家",
  );
  ok(
    mergedDuplicate?.invocation.modelInvocable &&
      mergedDuplicate?.invocation.userInvocable,
    "DSH 冲突赢家同时进入模型目录和斜杠菜单",
  );
  eq(
    (await getProviderSkill(mergedDuplicate, { sessionId: policySession }))?.content,
    "DSH 正文",
    "运行时加载的是 DSH 赢家正文",
  );
  eq((await setSourceEnabled("agents", true)).code, "error.policy.sessionOnly", "legacy source enable cannot alter priority");
  eq((await setSourceEnabled("codex", true)).code, "error.policy.sessionOnly", "legacy source enable cannot alter membership");
  eq(
    (await selectedCandidates()).filter(
      (candidate) => candidate.name === duplicateName,
    )[0]?.source,
    "user-dsh",
    "被拒绝的来源启用不能替换所选 DSH 赢家",
  );
  await selectMembers([member("agents", "issue-nine-agents"), member("codex", "issue-nine-codex")]);
  const disabledCandidates = (await selectedCandidates()).filter(
    (candidate) => candidate.name === duplicateName,
  );
  const mergedDisabled = await mergedSkillCandidate(
    duplicateName,
    [nativeDshCandidate],
    [nativeAgentsCandidate],
    disabledCandidates,
  );
  eq(
    mergedDisabled?.source,
    "agent-agents",
    "移除 DSH 成员后选择组内公共 Agent 副本",
  );
  ok(
    mergedDisabled?.invocation.modelInvocable === true &&
      mergedDisabled?.invocation.userInvocable === true,
    "仅选中的其他来源继续可调用",
  );

  const duplicateProject = join(tmp, "issue-nine-project");
  await mkdir(join(duplicateProject, ".git"), { recursive: true });
  await makeSkill(
    join(duplicateProject, ".dsh", "skills"),
    "project-copy",
    duplicateDoc("项目 DSH 正文"),
  );
  await makeSkill(
    join(duplicateProject, ".agents", "skills"),
    "project-agent-copy",
    duplicateDoc("项目 Agent 正文"),
  );
  const duplicateProjectRoots = await projectRoots([duplicateProject]);
  const duplicateProjectDsh = duplicateProjectRoots.find(
    (root) => root.kind === "project-dsh",
  );
  const duplicateProjectAgents = duplicateProjectRoots.find(
    (root) => root.kind === "project-agents",
  );
  await selectMembers([member(duplicateProjectDsh.key, "project-copy"), member("agents", "issue-nine-agents")], { projectCwds: [duplicateProject] });
  const projectCandidates = (
    await selectedCandidates({ sessionId: policySession, cwd: duplicateProject })
  ).filter((candidate) => candidate.name === duplicateName);
  eq(
    projectCandidates.length,
    1,
    "项目与用户同名条目按当前工作区只输出一个赢家",
  );
  const mergedProject = await mergedSkillCandidate(
    duplicateName,
    [nativeDshCandidate],
    [{ ...nativeDshCandidate, source: "project-dsh", rank: 100 }],
    projectCandidates,
  );
  eq(
    mergedProject?.source,
    "project-dsh",
    "未选的用户 DSH 和项目 Agent 不能遮蔽所选项目 DSH",
  );
  ok(
    mergedProject?.invocation.modelInvocable &&
      mergedProject?.invocation.userInvocable,
    "显式选中的项目原生赢家保持可调用",
  );
  eq(
    (await getProviderSkill(mergedProject, { sessionId: policySession, cwd: duplicateProject }))?.content,
    "项目 DSH 正文",
    "项目冲突加载正确工作区正文",
  );
  const projectWinnerState = (
    await selectedState({ projectCwds: [duplicateProject] })
  ).roots
    .find((root) => root.key === duplicateProjectDsh.key)
    .skills.find((skill) => skill.declaredName === duplicateName);
  ok(
    projectWinnerState.winner && projectWinnerState.enabled,
    "项目管理页与运行时赢家保持一致",
  );
  const outsideCandidates = (
    await selectedCandidates({ cwd: noGitWorkspace })
  ).filter((candidate) => candidate.name === duplicateName);
  eq(outsideCandidates[0]?.source, "agent-agents", "其他工作区不继承项目同名赢家");
  await makeSkill(
    join(secondProject, ".agents", "skills"),
    "independent-copy",
    duplicateDoc("另一项目正文"),
  );
  const independentRoot = (await projectRoots([secondProject])).find(root => root.kind === "project-agents");
  await selectMembers([member(independentRoot.key, "independent-copy"), member("agents", "issue-nine-agents")], { projectCwds: [secondProject] });
  const independentCandidates = (
    await selectedCandidates({ sessionId: policySession, cwd: secondProject })
  ).filter((candidate) => candidate.name === duplicateName);
  eq(
    independentCandidates[0]?.source,
    "project-agents",
    "不同项目独立选择自己的项目 Agent 赢家",
  );
  eq(
    (await getProviderSkill(independentCandidates[0], { sessionId: policySession, cwd: secondProject }))
      ?.content,
    "另一项目正文",
    "不同项目不会加载前一工作区的同名正文",
  );
  await selectMembers([member("agents", "issue-nine-agents")], { projectCwds: [duplicateProject] });
  const defaultProjectCandidate = (await selectedCandidates({ cwd: duplicateProject })).find(candidate => candidate.name === duplicateName);
  eq(defaultProjectCandidate?.source, "project-dsh", "project default outranks selected global copy without explicit exclusion");
  const projectExclusions = [member(duplicateProjectDsh.key, "project-copy"), member(duplicateProjectAgents.key, "project-agent-copy")];
  eq((await setSessionSkillExclusions(policySession, projectExclusions, undefined, { projectCwds: [duplicateProject] })).excludedSkills?.length, 2, "explicitly exclude both default project copies");
  const disabledProjectCandidates = (
    await selectedCandidates({ sessionId: policySession, cwd: duplicateProject })
  ).filter((candidate) => candidate.name === duplicateName);
  eq(
    disabledProjectCandidates.length,
    1,
    "排除项目副本后仍只输出一个实际赢家",
  );
  ok(
    disabledProjectCandidates[0]?.source === "agent-agents" &&
      disabledProjectCandidates[0]?.invocation.modelInvocable === true &&
      disabledProjectCandidates[0]?.invocation.userInvocable === true,
    "项目显式排除后回退到所选全局副本",
  );
  const mergedFallback = await mergedSkillCandidate(
    duplicateName,
    [nativeDshCandidate],
    [{ ...nativeDshCandidate, source: "project-dsh", rank: 100 }],
    disabledProjectCandidates,
  );
  eq(mergedFallback?.source, "agent-agents", "宿主原生项目候选不能抢回已排除项目副本");
  eq((await getProviderSkill(mergedFallback, { sessionId: policySession, cwd: duplicateProject }))?.content, "公共 Agent 正文", "回退加载全局正文");
  await setSessionLoadout(policySession, null);
  const allDisabled = (await selectedCandidates({ sessionId: policySession, cwd: duplicateProject })).filter((c) => c.name === duplicateName);
  const mergedAllDisabled = await mergedSkillCandidate(duplicateName, [nativeDshCandidate], [{ ...nativeDshCandidate, source: "project-dsh", rank: 100 }], allDisabled);
  ok(mergedAllDisabled?.invocation.modelInvocable === false && mergedAllDisabled?.invocation.userInvocable === false, "清除编组后项目排除仍阻断原生扫描恢复调用");
  eq((await sessionLoadoutView(policySession)).effective.skills.length, 0, "cleared selection has no implicit fallback");
  await makeSkill(
    dshRoot,
    "issue-nine-unique",
    "---\nname: issue-nine-unique\ndescription: 无冲突技能。\n---\n原生正文",
  );
  ok(
    (await selectedCandidates()).some(
      (candidate) => candidate.name === "issue-nine-unique" && !candidate.invocation.modelInvocable && !candidate.invocation.userInvocable,
    ),
    "unselected unique DSH inventory blocks native implicit loading",
  );
  await makeSkill(
    duplicateProjectDsh.path,
    "issue-nine-unique-project",
    "---\nname: issue-nine-unique-project\ndescription: 无冲突项目技能。\n---\n原生项目正文",
  );
  ok(
    (await selectedCandidates({ sessionId: policySession, cwd: duplicateProject })).some(
      (candidate) => candidate.name === "issue-nine-unique-project" && candidate.invocation.modelInvocable && candidate.invocation.userInvocable,
    ),
    "new unexcluded project skill is default-available even with no selected groups",
  );
  eq((await setSessionSkillExclusions(policySession, [...projectExclusions, member(duplicateProjectDsh.key, "issue-nine-unique-project")], undefined, { projectCwds: [duplicateProject] })).excludedSkills?.length, 3, "exclude the new project default explicitly");
  const excludedUnique = (await selectedCandidates({ cwd: duplicateProject })).find(candidate => candidate.name === "issue-nine-unique-project");
  ok(excludedUnique && !excludedUnique.invocation.modelInvocable && !excludedUnique.invocation.userInvocable, "explicit unique-project exclusion blocks both native invocation channels");
  await makeSkill(
    agentsRoot,
    "issue-nine-external",
    "---\nname: issue-nine-external\ndescription: 外部赢家。\n---\n公共正文",
  );
  await makeSkill(
    codexRoot,
    "issue-nine-external",
    "---\nname: issue-nine-external\ndescription: 外部副本。\n---\nCodex 正文",
  );
  await selectMembers([member("codex", "issue-nine-external")]);
  const externalCandidates = (await selectedCandidates()).filter(
    (candidate) => candidate.name === "issue-nine-external",
  );
  eq(externalCandidates.length, 1, "没有 DSH 副本时同样只保留外部同名赢家");
  ok(
    externalCandidates[0]?.source === "agent-codex" &&
      externalCandidates[0]?.invocation.modelInvocable === true &&
      externalCandidates[0]?.invocation.userInvocable === true,
    "仅选择 Codex 副本时可调用该副本",
  );
  await makeSkill(
    dshRoot,
    "issue-nine-invalid",
    "---\nname: issue-nine-invalid\n---\n缺少简介",
  );
  await makeSkill(
    codexRoot,
    "issue-nine-invalid",
    "---\nname: issue-nine-invalid\ndescription: 有效副本。\n---\n有效正文",
  );
  await selectMembers([member("dsh", "issue-nine-invalid"), member("codex", "issue-nine-invalid")]);
  eq(
    (await selectedCandidates()).find(
      (candidate) => candidate.name === "issue-nine-invalid",
    )?.source,
    "agent-codex",
    "结构无效的高优先级条目不参与同名赢家判定",
  );
  eq(
    await readFile(join(dshRoot, "issue-nine-local", "SKILL.md"), "utf8"),
    duplicateDoc("DSH 正文"),
    "冲突处理及启停不改写来源文件",
  );
} finally {
  await writeFile(managerStatePath(), duplicatePolicyBefore, "utf8");
}

// 清理
await rm(tmp, { recursive: true, force: true });
delete process.env.DSH_HOME;
delete process.env.DSH_AGENTS_HOME;
delete process.env.DSH_CODEX_HOME;
delete process.env.DSH_CLAUDE_HOME;
delete process.env.DSH_GEMINI_HOME;
delete process.env.DSH_OPENCODE_HOME;
delete process.env.DSH_CURSOR_HOME;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
