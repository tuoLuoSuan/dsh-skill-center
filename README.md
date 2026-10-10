# 技能中心 · dsh-skill-center

一个 [DeepSeek Harness](https://github.com/deepseek-ai) 插件，在侧边栏里搜技能，看清了再装。

```powershell
dsh plugin --profile <你的 profile> add dsh-skill-center
```

装上之后侧边栏底部会多出一个「技能中心」按钮：

![浏览技能](docs/screenshots/browse-light.png)

| | |
| --- | --- |
| ![同名冲突](docs/screenshots/conflict-dark.png) | ![本机导入](docs/screenshots/local-light.png) |
| 占名、缺件、不完整、名字不合法：四种坏法各配自己的后果与选项 | 扫描 35 个别的 agent 技能目录，把 DSH 看不见的技能导进来 |
| ![已安装](docs/screenshots/installed-light.png) | ![深色主题](docs/screenshots/browse-dark.png) |
| 装完之后的状态：来路、更新检查、调用开关、回收站 | 颜色全走 `--dsw-alias-*` 令牌，没有第二套样式表 |

面板分三块。**发现**聚合 5 个来源的技能目录，能按中英文关键词搜，也能按分类和 star 排序。**已安装**直接读你本机的 `~/.dsh/skills`，把每个技能的来源、文件数和校验结果列出来，并且可以就地开关（关掉不等于删掉，见下面「关掉一个技能」），还能告诉你每个技能被模型调用过几次。**本机**扫的是 35 个别家 agent 的目录，把 DSH 看不见的技能导进来。

想看清楚再动手就进详情页：仓库目录树、`SKILL.md` 原文、逐个文件预览。确认后写到 `~/.dsh/skills/<name>/`，harness 的 chokidar 立刻侦测得到，不用重启。

侧边栏按钮、`shell.overlay` 抽屉、设置页里的内联分区，三个入口共用同一份状态。

---

## 装得上，不等于 harness 会认它

这个插件大部分代码在处理这两者之间的落差。

### 装之前先告诉你它会怎么坏

| 检查 | 不做的话会怎样 |
| --- | --- |
| frontmatter 体检 | `name` 不合法（`PDF-Processing`、`my_pdf_tool`）的技能会被 harness 静默跳过。装完看起来成功，列表里什么都没有。面板会直说「照现在这样装上去，DSH 会直接忽略它」；能一键改写 `name:` 行的就改，缺 frontmatter 或缺 description 的拒绝安装，不装作成功 |
| 完整性 | 一次 429 或超时会让仓库遍历半途而废。技能看起来干净，缺的却是它自己让模型去跑的脚本。详情页标出「完整 / 部分」，并列出停止取回的原因和条数 |
| 引用缺件 | `SKILL.md` 里 `` `scripts/build.py` `` 或 `[schema](references/schema.md)` 指向的文件如果不在取回的目录里，会被列出来。这类问题只在模型第一次真用它时才爆，而且爆在别人的任务中间 |
| 同名冲突 | 目标名字已被占用时不静默覆盖，也不静默加 `-2`。两种做法都是你事后才发现的性质。三个选项连后果一起摆出来：覆盖（先把现有版本完整挪进 `.backup/`）、改名装为 `pdf-2`、跳过。默认永远是不动现有的那个 |

### 装下来的就是那一次提交

安装读的是 **commit**，不是分支名：

```
一次请求  api.github.com/repos/{owner}/{repo}/commits/{branch}   → 拿到 commit SHA
一次请求  codeload.github.com/{owner}/{repo}/tar.gz/{sha}        → 整棵树，不可变
```

分支名是可变引用，commit 是不可变引用。`raw.githubusercontent.com` 对分支名有 `max-age=300` 的 CDN 缓存，所以「刚才看是这版、五分钟后装下来是上一版」是可能的；按 SHA 取，缓存命中永远是对的。本项目自己撞过这个坑：推完 README 立刻校验，读到的还是上一版。

详情页会写它是哪一版：「上游版本 `8ca22db` · 最后提交 2026-09-25」。问不到版本时（匿名 API 配额是 60 次/小时）它会明说「没能问到上游版本，这次抓的是分支当前内容」，而不是假装钉住了。

两条抓取路径都按 commit 读。主路径是一次 codeload 归档，归档不可达时回落到逐文件抓取，但回落也读那个 commit。否则回执上会写着一个它从没读过的版本，下一次更新检查就会拿错东西去比。只有连 commit 都问不到才读分支，那种情况下回执不写版本，界面也照实说。

一次请求拿整棵树，不是每个文件一次：80 个文件就是 80 次请求，也更容易在中途失败。读过的 commit 只下载一次，键就是 commit，所以这条缓存永远不会过期，也不需要失效：换个版本就是换了个键，不是这个键下的旧值。

二进制文件不再被写坏。旧路径把所有内容按 UTF-8 解，技能里的 PNG / PDF 会被静默损坏；现在按字节判断，非文本走 base64 存盘。解 tar.gz 是手写的约 60 行，用 Node 自带的 `zlib`，运行时依赖仍然是 0。

### 装完之后看得见的状态

每个装过的技能都记住自己来自哪个源、哪个仓库、哪条路径、哪个 commit，列表里直接显示。

更新检查分两步。先问分支现在的 commit，和记录里的一样就到此为止，一个文件都不用下，而且结论是确定的（同一个 commit 命名同一棵树）。不一样才去取那一版，算整棵树的哈希：

- 树也一样 → 最新，同时把记录里的 commit 前移，下次检查又变回一次小请求
- 树不一样 → 有更新

这里和旧行为最实质的差别是哈希的范围：从只算 `SKILL.md` 变成整棵树，所以上游改一行 `scripts/*.py` 也瞒不过去，而这恰恰是技能最常被修的地方。拿不到版本信息时会降级成只比 `SKILL.md`，并在结果里标出这次的结论只覆盖了文档（`depth: document`）。

删除是移进 `.trash/` 而不是抹掉，并弹出可撤销提示。被删的技能连同它的来路记录一起进桶，恢复后仍是「受管理」的技能。同名覆盖时，上一版完整保留在 `<root>/.backup/<name>-<时间戳>/`。

`.trash` 与 `.backup` 都带点前缀，是刻意的：harness 靠「目录里直接含 `SKILL.md`」判定技能，所以它两个都看不见，不会被当成技能列出来。

---

## 安装

已发布到 npm：[`dsh-skill-center`](https://www.npmjs.com/package/dsh-skill-center)

```powershell
dsh plugin --profile <你的 profile> add dsh-skill-center
```

包名会从 npm 上解析，和你装任何别的 DSH 插件是同一条路。桌面版自带 CLI 的路径随安装位置变化，
Windows 上在 `<安装目录>\resources\runtime\cli\bin\dsh.cmd`。

想改用源码（要改代码、或想跑本仓库里那套检查）：

```bash
git clone https://github.com/tuoLuoSuan/dsh-skill-center.git
dsh plugin --profile <你的 profile> add "<仓库路径>"
```

> **`--profile desktop` 会被普通 CLI 拒绝**（`profile "desktop" is managed exclusively by
> the Electron application`）。要让桌面版自己的 profile 生效，得用上面那条 Electron 附带的
> `dsh.cmd`，或者直接在应用内的插件管理界面里添加。

只要 profile 的 `package.json` 里 `dsh.profile.bundles` 有了本插件，且 `cordis.patch.yml`
是**纯 insert**（本仓库就是），就能热挂载，**不需要重启**。此后客户端代码改动同样热重载（刷新页面即可）；
`lib/` 下的宿主代码改动仍需要重启。

本包没有任何运行时依赖：`dependencies` 是空的，装下去的就是 `lib/`、`client/`、`locale/`
和两个清单文件，23 个文件、115.5 kB 打包（解开 382.8 kB）。对 `@deepseek-ai/dsh` 的依赖写在
`peerDependencies` 里（`>=0.2.0-rc.2`）并标了 `optional`。它是一道版本门禁，不是要去安装的
东西：DSH 读这个字段判断插件和当前运行时兼不兼容，pnpm 则因为 `optional` 不会去装第二份宿主。

### 怎么确认装上了

插件本身会告诉你它有没有活着，不用去翻日志：

1. 侧边栏底部多出一个「技能中心」按钮（注册在 `sidebar.footer.action` 槽）。
2. 点开抽屉后，左下角「发现」标签页里的来源轨应当列出 5 个来源。如果它报「宿主代码还是旧版本」，说明宿主那一半没加载。`lib/` 是宿主代码，加完插件要重启一次 DeepSeek Harness；之后改 `client/` 就只需要刷新页面。
3. 面板底部的条数必须是实时数。这个数来自 `GET /dsh-skill-center/api/sources`，不写死。看到 0 或者一直转圈，那是上游没连上，不是装错了。在浏览器里直接开 `http://127.0.0.1:<端口>/dsh-skill-center/api/sources` 就能看到原始 JSON 和真实错误。

`0.2.0-rc.2` 上验证过。更低版本会被上面那道版本门禁拦住（见「兼容性」）。

---

## 配置

在 profile 的插件配置里可选地提供：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 技能根目录的父目录 |
| `cacheDir` | `<dshHome>/skill-center/cache` | 上游响应缓存 |
| `trustedHosts` | `[]` | 反代/隧道场景下额外放行的 Host |
| `skillsmpApiKey` | 空 | 提高 skillsmp 的每日配额 |
| `agentHome` | 真实 OS home | 其他 agent 技能目录的父目录（测试用覆盖项） |

---

## 关掉一个技能，但别把它删掉

「已安装」那一页每个技能右边有一个开关：关掉之后技能还在原处、还能读、还能再打开，
只是模型不会再看到它。列表按来源分组，每组标题右边还有一个总开关（全组启用 / 全组禁用），
关掉的技能挂一个 `已禁用` 标签，页头汇一个总数。

开关改的是技能**自己 frontmatter 里的 `disable-model-invocation`**——就是宿主真正读的那个字段，
不是把文件改名或搬走。这么选换来三件事：

- 技能待在原地，所以列表还列得出来、正文还打得开；改回来只是删掉一行，文档**逐字节**回到原样。
- 对一个不是本插件装的技能一样能用。
- 技能目录在 git 仓库里时，改名会显示成一次删除，改一行不会。

写入是**逐字节编辑 frontmatter 那一段**（`setFrontmatterFlag`），不是把 YAML 解析出来再重新序列化：
手写的注释、缩进、键顺序都留着。`docs/probe-toggle.mjs` 问的正是这件事，而且问三遍——
翻过去是不是宿主认的那个「关」、翻回来是不是**原来那份字节**、以及一份它改不了的文档
是不是被**拒绝**而不是写坏。

改不动的会被拒绝，并且说出是哪个字段：frontmatter 里用了宿主不认的旧写法时，
宿主是**整份丢掉**这个技能的，那么给它写开关就等于报告了一次谁也看不见的变化。

只在三个根上生效：`~/.dsh/skills`、`<工作区>/.dsh/skills`、`<工作区>/.agents/skills`。
其他 agent 的技能目录（`~/.claude/skills` 等）只读。

请求里 `enabled` 是**必填**的布尔值，不从当前状态推断：先读、再决定、再写，
是和这份文件的所有其他写入者赛跑，双击还会落在第二次读到的任意一边。

---

## 数得出来的调用次数

「已安装」页每个跑过的技能会挂一个「用过 N 次」，鼠标停上去显示最后一次是哪天。数据不是猜的：
技能调用在会话日志里就是一次工具调用，工具名 `skill`，参数里带着技能名。读 `~/.dsh/sessions/`
下的 `session.v4.jsonl.zstd` 数出来就行。

只有一个坑，而且它很安静：**那些日志是多帧 zstd**——每次追加是一帧，一个文件里拼着好几帧。
`zlib.zstdDecompressSync` 只解第一帧就返回，不报错：一个 121,404 字节的日志会「成功」解成 284
字节，解出来还是合法 JSON。所以 `lib/usage.js` 自己按魔数 `28 B5 2F FD` 切帧、逐帧解。顺带的好处
是峰值内存只有一帧，不是整个档。本机 87 个会话、64 MB 压缩，冷读一次 1.9 秒，之后每次 7 毫秒
（按文件大小和 mtime 复用）。所以它是一条单独的 `/usage` 路由：列表先画出来，计数随后到，
首屏不压在这一次解压后面。

值得先说清楚一件事，免得装上去以为坏了：**这台机器上装了大约 40 个技能，历史上只调用过 6 个**
（`nature-writing` 3 次，其余各 1 次，合计 9 次）。装了不用是常态，所以面板不把「0 次」铺在每一行
上——只给真跑过的打标签，想知道哪些从来没碰过就用页头那个筛选器。页头还会直接写「用过 6 个」。

另外，「没有数据」和「一次也没用过」是两个答案，面板不合并它们。Node 22.15 之前没有
`zstdDecompressSync`，那时整个功能报「这个 Node 读不了会话日志」，而不是显示一排 0；日志目录不存在
也一样。

---

## 「本机」到底扫哪些目录

35 个：21 个用户级（`~/.claude/skills`、`~/.codex/skills`、`~/.gemini/skills`、
`~/.config/opencode/skills`、`~/.codeium/windsurf/skills`、`~/.windsurf/skills`、
`~/.trae/skills`、`~/.trae-cn/skills`、`~/.qoder/skills`、`~/.qoder-cn/skills`、
`~/.lingma/skills`、`~/.openclaw/skills`、`~/.clawdbot/skills`、`~/.cc-switch/skills`、
`~/.roo/skills`、`~/.codebuddy/skills`、`~/.workbuddy/skills`、`~/.copilot/skills`、
`~/.cursor/skills`、`~/.gemini/antigravity/skills`，以及 `~/.agents/skills`），
14 个项目级（`<项目>/.claude/skills`、`.codex`、`.gemini`、`.cursor`、`.github`、
`.opencode`、`.windsurf`、`.trae`、`.trae-cn`、`.qoder`、`.roo`、`.codebuddy`、
`.workbuddy`，和没有归属者的 `<项目>/skills`），外加你自己在配置里加的路径。

这张表故意写得很笨：一个 agent 一行，路径照它自己文档里写的抄，相邻的绝不类推。
理由是不对称的——少一行，用户会在「本机」看到一个空列表，然后认为这台机器上没有别的东西；
多一行指错了地方，`readdir` 要么什么也没找到（同样看不见），要么那个目录碰巧存在，
于是从一个没有任何 agent 写过的目录里导入。两种情况都不报错。

这条不对称不是假想的。这张表原来只有 6 行（Claude Code、Codex、Agents、Gemini、
Antigravity 和 Claude Code 的项目级）。扩到 35 行之后，同一台机器上多扫出
17 个技能——它们在 `~/.workbuddy/skills` 里，而旧表根本没写这个目录。
这不是「顺便多支持了几个工具」，是那 17 个技能在这之前一直不存在于这个面板里。

用户级的那 21 行可以用环境变量改基准目录：`DSH_CLAUDE_HOME`、`DSH_CODEX_HOME`、
`DSH_GEMINI_HOME`、`DSH_OPENCODE_HOME`、`DSH_CURSOR_HOME`、`DSH_COPILOT_HOME`、
`DSH_WINDSURF_HOME`、`DSH_WINDSURF_USER_HOME`、`DSH_TRAE_HOME`、`DSH_TRAE_CN_HOME`、
`DSH_QODER_HOME`、`DSH_QODER_CN_HOME`、`DSH_LINGMA_HOME`、`DSH_OPENCLAW_HOME`、
`DSH_CLAWDBOT_HOME`、`DSH_ROO_HOME`、`DSH_CODEBUDDY_HOME`、`DSH_WORKBUDDY_HOME`、
`DSH_AGENTS_HOME`。这套名字和 `@michengai/dsh-skills-manager` 用的是同一套，
所以为那个插件配过环境变量的机器不用再配第二遍。

`docs/probe-roots.mjs` 问的就是这张表本身，而不是它的行为：这个 id 在这个 home 下解析到
哪个路径、覆盖变量改了谁、给了环境变量它就照办、没给就一个都不看。最后一条是让这个探针
在本机上仍然诚实的原因——如果哪天有人把 `env` 透传成 `process.env`，探针会在一个本身
设了 `DSH_CLAUDE_HOME` 的机器上开始飘。

---

## 数据来源

| 来源 | 用途 | 需要密钥 |
| --- | --- | --- |
| [claudeskills.info](https://claudeskills.info) | 主枚举源，中文可搜 | 否 |
| [awesome-claude-skills](https://github.com/Chat2AnyLLM/awesome-claude-skills) | 仓库坐标表（repo + branch + path） | 否 |
| [anthropics/skills](https://github.com/anthropics/skills) | 官方技能仓库 | 否 |
| [skillsmp.com](https://skillsmp.com) | 搜索语料（匿名有每日配额） | 可选 |
| 已装 DSH 插件 | 各插件自带的技能包 | 否 |

正文一律经 `raw.githubusercontent.com` 取回（GitHub REST 未鉴权会 403，所以不用它）。

关于数字口径：claudeskills 的 `type=skill` 按仓库去重后约 1,679 条，所以面板底部
显示的是这个数；条目总数（含 plugin / subagent / command / hook）与分类数会随时变动，
以 `GET /dsh-skill-center/api/sources` 的实时返回为准，不要在别处引用一个固定的总数。

---

## HTTP 接口

宿主侧把所有端点注册在一条 `prefix` 路由 `/dsh-skill-center/api` 下：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/sources` | 来源描述符 + 分类法 + 配额 + 已装计数 |
| GET | `/installed` | 扫描本机技能根，附来路记录、回收站条数与受管理计数 |
| GET | `/list` | `?source=&q=&kind=&category=&sort=&page=&limit=` |
| GET | `/agents` | 扫描其他 Agent 的技能目录（`~/.claude/skills` 等） |
| GET | `/trash` | 列出回收站 |
| GET | `/updates` | 对所有受管理技能做一次更新检查 |
| GET | `/usage` | 数每个技能被调用过几次（`?force=1` 忽略缓存重扫） |
| POST | `/item` | 取详情（含 `SKILL.md` 原文） |
| POST | `/preview` | 取待安装文件清单 + 体检 + 完整性 + 引用缺件 + 同名冲突 + `revision`（本次读的是哪个 commit） |
| POST | `/install` | 落地到 `~/.dsh/skills/<name>/`；`conflict` 取 `fail`（默认）/`skip`/`rename`/`replace` |
| POST | `/remove` | 移进回收站（仅限用户根，项目根只读）；`permanent: true` 才真删 |
| POST | `/restore` | 从回收站恢复，连来路记录一起接回去 |
| POST | `/purge` | 清空回收站（或其中一个桶） |
| POST | `/update` | 按来路记录重新拉取并覆盖安装 |
| POST | `/import-local` | 从发现的 agent 目录导入（复制，不是就地注册） |
| POST | `/read` | 读已安装技能正文 |
| POST | `/toggle` | `{ name, enabled }` 改技能 frontmatter 里的 `disable-model-invocation`；`enabled` 必填布尔 |

浏览器永远只跟宿主对话，不直连上游，所以没有 CORS 问题，密钥也不会到前端。

### 安全边界

- 每个请求（含 GET）都过同源校验：Host 缺失放行（非浏览器），Host 存在则必须是 loopback 或在 `trustedHosts` 里；`sec-fetch-site: cross-site` 直接拒；Origin 存在但解析失败也拒。
- 技能名必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`；安装路径经 `containedChild` 校验，`../` 与绝对路径一律拒绝。
- 只**安装**到 `~/.dsh/skills`；`/remove` 也只动用户根，项目根下的技能目录以 `writable: false` 呈现。
- `/toggle` 是唯一的例外，它按设计会写工作区里的技能：`~/.dsh/skills`、`<cwd>/.dsh/skills`、`<cwd>/.agents/skills` 三个根，且只改 `SKILL.md` frontmatter 里的一个布尔字段，不新建、不移动、不删除文件。
- `/import-local` 不信任客户端报上来的路径：它重新扫描一遍 agent 目录，并要求请求里的路径确实出现在扫描结果里。否则这条路由就是一个任意文件读取原语。
- 导入是复制，不是把外部目录注册进来。就地注册的话，卸载本插件会连带删掉你的 Claude Code 配置，而且在 DSH 里编辑会改到别的 agent。
- 那张 35 行的目录表是只读的：它 list 一遍、读一遍 `SKILL.md`，从不往别家 agent 的目录里写任何东西。唯一的例外是 `/import-local`，而它写的是 `~/.dsh/skills`，也就是你自己的 DSH 技能根。

> 插件的 `exact`/`prefix` 路由注册在裸 `webServer` 上，匹配优先于 DSH 自己的 `/api` 围栏，围栏看不到它们，所以同源校验必须自己做。

---

## 开发

```bash
node docs/smoke-host.mjs       # 宿主半边：桩 cordis context + 真实 node:http + 真实上游
node docs/smoke-client.mjs     # 客户端半边：迷你 React + 桩 DOM + 桩 fetch
node docs/check-classes.mjs    # 样式表漂移：渲染出的 sc- 类是否都有定义
node docs/check-sorts.mjs      # 各源的排序键是否真的排了序（需要联网）
node docs/preview.mjs          # 把真实 bundle 渲染成 HTML，再用 Chrome 无头截图
node docs/preview.mjs --no-shot
node docs/audit-publish.mjs    # 发布前自检：账号名残留与写死的绝对路径
node docs/check-published.mjs  # 陌生人此刻在 GitHub 上看到的到底是什么（读 API）
                               # 匿名配额只有 60 次/小时；设 GITHUB_TOKEN 可提高
                               # 退出码 0=全过 1=有失败 2=有项目没查成（网络/配额）
node docs/look-at-page.mjs     # 上面那一页渲染出来好不好看（读 HTML，不是 API）
node docs/shot-page.mjs        # 把那一页真的截一张图下来，自己看一眼
node docs/verify-clone.mjs     # clone 一份公开仓库，验证陌生人的 checkout 真的能用
node docs/probe-npm-install.mjs  # 从 npm 装进一个用完就删的 profile，验证陌生人那条路能用
                                 # （不带参数时装 registry 上的版本；给个路径则装本地 tarball）
node docs/probe-sources.mjs    # 各上游可达性与契约实测
node docs/probe-validate.mjs   # frontmatter 体检与改名的往返
node docs/probe-references.mjs # SKILL.md 引用扫描的误报/漏报
node docs/probe-agents.mjs     # 其他 Agent 技能目录的发现结果（扫本机真实目录）
node docs/probe-roots.mjs      # 那张目录表本身：每个 id 解析到哪个路径、覆盖变量改了谁（临时目录，不碰本机）
node docs/probe-tarball.mjs    # tar.gz 解码器（合成包 + 一个真实仓库）
node docs/probe-freshness.mjs  # 按 commit 钉住、整棵树比对与缓存命中（真实网络）
node docs/probe-glass.mjs      # 抽屉在玻璃主题下还实不实、设置页里有没有多铺一张底板（先跑一次 preview.mjs）
node docs/probe-rail.mjs       # 每个来源标签是否都在屏幕里（先跑一次 preview.mjs）
node docs/probe-toggle.mjs     # 调用开关：翻过去是宿主认的那个值吗、翻回来是原来那份字节吗
node docs/probe-usage.mjs      # 调用次数：多帧日志真的全读到了吗（合成日志，不读本机会话档）
```

两个冒烟测试都不碰真实的 `~/.dsh/skills`（宿主测试写进 `mkdtemp` 临时目录）。
`docs/preview.mjs` 需要 Chrome 或 Edge；找不到时会打印一行并跳过截图（不失败）。
浏览器不在默认位置就用 `SKILL_CENTER_CHROME=<可执行文件路径>`。

`docs/theme.css` 和几份 slot / service 目录 JSON 是从 DeepSeek 自己的 bundle 里抽出来的，
**没有提交进仓库**（`node docs/theme-tokens.mjs`、`node docs/extract-slot-catalog.mjs`
可以对着你自己的安装重新生成）——所以全新 clone 直接跑 `preview.mjs` 之前，先跑一次
`theme-tokens.mjs`。

`docs/verify-clone.mjs` 就是把上面这件事反过来验一遍：它 clone 一份公开仓库到临时目录，
跑一遍裸 clone 上应当通过的检查，确认没有哪个文件只存在于作者的机器上（生成的产物忘了提交、
只在本机存在的路径、假设了兄弟目录的脚本）。它检验的是「别人拿到这个仓库能不能用」，不是
「作者的机器上能不能用」。两件事不一样，这个脚本存在的唯一理由就是它们不一样。
（它自己踩过两个坑：`spawnSync` 的 `cwd` 指向尚未创建的目录会报 `ENOENT`，看起来像
"git 没装"；把子进程输出接进管道需要一个具名管道，而沙箱会拒绝，失败以 `result.error`
上的 EPERM 抵达、stdout 为空——与"运行成功但没输出"无法区分。所以它用
`stdio: 'inherit'`，并在 `result.error` 上显式报错。）

`dsh.cmd` 是一层两行的壳，真正的可执行文件是 Electron 自己（`ELECTRON_RUN_AS_NODE=1` 加一段
asar 里的 JS）。`probe-npm-install.mjs` 直接调那个二进制，不走 `.cmd`：Node 在没有 shell 的
情况下拒绝 spawn `.cmd`（`EINVAL`），而走 shell 就要给一个含空格的路径加引号。它顺便回答一个
发布前必须问的问题：宿主拿到的是一个插件，还是第二份它自己。后者正是 `@deepseek-ai/dsh`
写进 `peerDependencies` 的副作用，所以那一项标了 `optional`。

改动 `lib/` 下的宿主代码后需要**重启 harness** 才生效；`client/client.js` 由
`@deepseek-ai/dsh-client-hmr` 轮询热重载，保存即可看到。

> 本仓库的脚本和文档含中文，**不要用 PowerShell 的 `Get-Content`/`Set-Content` 做
> 文本替换**——Windows PowerShell 5.1 会按 ANSI 代码页往返，把多字节字符压成
> `U+FFFD`。用编辑工具，或用 Node 读写 `utf8`。

### 预览回路

`docs/preview.mjs` 是改界面时的主要反馈回路：它在 Node 里求值一遍真实的
`client/client.js`，用桩 DOM / 桩 fetch 驱动真实交互（点侧边栏按钮开抽屉、点卡片
进详情、点安装出确认面板），输出 10 个场景 × 明暗两套的 HTML 与 PNG，不重启 harness
就能看到界面。它顺带发现过两处夹具错误（`counts` 形状、`/item` 响应形状）、
一处夹具缺口（`/updates` 少顶层 `checkedAt`，页脚渲染成 `Invalid Date`）与一处真 bug
（完整性提示拼错了字段），值得在改渲染函数后先跑它。

**这块面板不在玻璃主题下让路。** 壁纸类插件把宿主变透明的办法，是把
`--dsw-alias-bg-layer-*` 这几个别名重写成 `color-mix(…, transparent)`；凡是拿这些别名
当自己背景的面，壁纸就会透上来。对话气泡透一点没问题，一张罗列文件树的列表不行。所以
面板的颜色画在一块不透明底板上：`--sc-plate` 取自静态调色板
（`--dsw-static-neutral-bluish-*`，任何主题都不改写它），`--sc-solid` 再把主题底色叠在
它上面。没有玻璃主题时两层同色，等于什么都没改；有玻璃主题时面板仍是实心的。

但这张底板只铺在抽屉里，因为只有抽屉那块地是它的。设置页那一份是宿主的地盘，面板在那儿
是客人。客人自己铺一张底板，就是在设置对话框上盖一个白方块，方到能从对话框自己的圆角里
冒出来。0.2.1 就是这样，在设置页里看着像个异物。所以 `--sc-solid` 只画在抽屉上，
`.sc-root` 什么都不画：抽屉里由抽屉铺，设置页里由宿主铺。

`docs/probe-glass.mjs` 把这个约定变成断言：它不问壁纸插件在不在，只问「别名被别人改成
半透明之后，这块面还实不实」，并且先确认那次改写真的生效了，否则这个测试什么也没证明。
同一个探针再从反面问一遍：设置页里 `.sc-root` 算出来的背景必须是 `rgba(0, 0, 0, 0)`。
它顺手把两种渲染都拍下来（`preview/glass-<theme>-before.png` 与 `glass-<theme>.png`，
一张是原来的样子、一张是现在的样子）。判断对错的不是这些图，是那十二个数；图是给会去看
的人看的，免得他先把断言信了。

**来源标签一行放不下就换行，不横滚。** 原来是一行到底、放不下就左右滚，右边缘还加了一道
渐隐遮罩，想让被切掉的标签看起来像「还有更多」。遮罩不是提示：一个来源可以整个落在边缘
外面，而唯一能发现它的办法是去滚一条根本不画滚动条的带子。有人就是这么中招的——靠无意间
按了一下方向键才看见「DSH 技能包」。现在 `.sc-sources` 会换行，`flex-basis: 600px` 是五个
标签一行所需的宽度：要不到这么多，它就落到视图切换下面独占一行；要得到（设置页），它还
在原处。`docs/probe-rail.mjs` 只问一个截图答不上来的问题：每个标签是不是都在自己的容器
里。它问两遍，第二遍把旧声明强制加回去，因为一个不可能失败的检查不算检查。

### 文件

- `lib/index.js` 宿主入口：路由与分发
- `lib/sources.js` 五个来源适配器
- `lib/github.js` GitHub URL 解析 / 目录列举 / 文件收集
- `lib/skills-dir.js` 技能根扫描、安装、回收站、备份、改名
- `lib/validate.js` `SKILL.md` 体检与 `name:` 行改写
- `lib/completeness.js` 「这次取回的文件树是否完整」
- `lib/references.js` `SKILL.md` 引用的文件是否存在
- `lib/tarball.js` 手解 tar.gz（一次请求拿到一个 commit 的整棵树）
- `lib/provenance.js` 安装来路记录（`<root>/.skill-center.json`），含整棵树的哈希
- `lib/updates.js` 按来路记录比对上游：先比 commit，必要时再比整棵树
- `lib/agents.js` 其他 Agent 技能目录的发现与导入
- `lib/usage.js` 会话日志里数技能调用次数（自己按魔数切多帧 zstd）
- `lib/frontmatter.js` `SKILL.md` frontmatter 解析
- `lib/http.js` `sendJson` / `readJsonBody` / `sameOrigin`
- `lib/net.js` 带超时、重试、缓存的上游抓取
- `client/client.js` 浏览器 bundle（手写 classic script，**无构建链**）
- `docs/mini-react.mjs` 迷你 React + `mount` / `renderHtml`，冒烟测试与预览共用

---

## 兼容性

面向 DSH `0.2.0-rc.2`。刻意不使用 `@deepseek-ai/dsh-client-ui-primitives` 的任何导出，
也不 import `installSettingsSection` / `settingsNamespace`。前者在 0.1.7 会重命名图标，
后者在当前版本根本不存在，而且缺失的具名导入是模块求值期的 SyntaxError，会整棵插件树
一起崩掉。图标全部内联 SVG，颜色一律走 `--dsw-alias-*` 令牌，因此自动跟随明暗主题。

不要按 peer 自身的版本号写 `peerDependencies`：DSH 的门禁是拿 range 去和 dsh 自己的
版本做 `semver.satisfies`，所以 `"@deepseek-ai/cordis": "~4.0.4"` 这种写法语义是错的。

`engines.node` 写的是 `>=20`，但调用次数这一项要 Node 22.15 才有 `zlib.zstdDecompressSync`。
低版本上插件照常工作，只是这一项会说明自己读不了，而不是显示一排 0。

想查某个 UI 插槽的契约：

```bash
node docs/extract-slot-catalog.mjs <你解包出来的 dsh-cordis-client-runner/lib/client.js>
node docs/show-slot.mjs sidebar.footer.action
```

### 样式表要自己认领，否则会被别人领走

宿主里只有两处代码会动 `<style>` 标签的归属，而它们都只看标签自己的属性：

- `@deepseek-ai/dsh-client-modules` 物化任何插件时，把它那一刻所有还没打 `data-plugin` 的 `<style>` 全部盖上那个插件的名字（`claimStyles`，`lib/client.js:172`）。
- `@deepseek-ai/dsh-client-hmr` 在某个插件热重载时，删掉所有 `style[data-plugin=<它>]`（`removeOwnedStyles`，`lib/client.js:54,80`）。

这个 bundle 的样式表是在 `apply()` 里注入的，而 `apply()` 跑在自己的物化之后。那一刻
`claimStyles` 已经错过，标签是「无主」的。于是之后任何一个别的插件物化都会把它领走；
用户下次更新那个插件时，宿主就顺手把技能中心的样式删掉了。DOM 还在、面板照常渲染，
只是一条规则都不生效。看起来就是「界面乱了」，重启才好。

修法是照宿主自己的写法（`@deepseek-ai/dsh-client-ui-*` 二十来个包全都这么干）：

```js
tag.dataset.plugin = 'dsh-skill-center'               // 归属，claimStyles / removeOwnedStyles 用它比对
tag.dataset.pluginCss = 'dsh-skill-center/client.css' // 唯一标签 id，兼重复注入的守卫键
```

而且永不 remove：样式表属于文档，不属于某个 fiber，所以 disposer 是空函数。面板还挂着的
时候把样式撤走，只会把它剥光。`docs/smoke-client.mjs` 的 `[stylesheet ownership]` 与 `[the stylesheet survives a second activation]` 两段就是守这三条，包括「再 `apply()` 一次不会多出一张样式表」。

### 视觉

视觉上贴着 DSH 自己的设计系统走，不带第二套配色。

DSH 基本是单色系统。`--dsw-alias-brand-primary` 浅色下是近黑 `#0f1115`、深色下是近白
`#f9fafb`，主按钮就是黑/白药丸；唯一成体系的彩色是 `--dsw-alias-link`（`deepseek-500` /
`deepseek-400`）。所以皮肤的强调色只有这一处蓝，状态色只用 red / green / amber 令牌。
`--dsw-alias-bg-skeleton`、`--dsw-shadow-lv1/2/3`、`--dsw-font-*`、`--dsw-alias-markdown-*`
都直接复用，字号与圆角不自己发明。

浅色下 `bg-base` 与 `bg-layer-1/2/3` 四个值全是纯白，层次只能靠边框、遮罩与阴影做；深色下
四层才真的分得开（950 / 875 / 850 / 800）。因此卡片用 `border-l1` 发丝边加 hover 才浮起，
而不是给面板加底色。

还有一条是踩过才记住的：别名令牌会随主题翻转，底色不翻转的组件就不能拿它上墨。
`--dsw-alias-toast-bg` 在浅色和深色下都是深的（`neutral-bluish-800` / `750`），而
`--dsw-alias-label-primary` 浅色下是近黑，两个凑一起就是黑底黑字。这个 bug 出现过一次，
只在浅色下可见，靠用户在真实界面里发现。给固定深色表面配字要用永远为浅的调色板项
（`--dsw-static-neutral-bluish-00`），不是会翻转的别名；反过来，主按钮那种底色自己会翻转
的地方（`button-primary-fill` + `label-primary-foreground`）就该成对用别名。

全部尺寸与颜色收敛在 `.sc-scope` 这一个作用域根的 CSS 变量里，主题切换不需要第二套样式表。

---

## 许可

[MIT](LICENSE)。插件本身不打包任何技能内容，安装时按需从上游取回；
各技能的许可条款以它自己的仓库为准（预览页会显示识别到的 `license` 字段）。
