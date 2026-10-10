/**
 * Browser half of the skill center.
 *
 * This file is a hand-written classic-script bundle: the host serves it from
 * `exports["./client"]` and expects the `window.__ModuleLoader__.load`
 * registration whose `id` equals the package name. There is no build step —
 * JSX is replaced by direct `React.createElement` calls, and the only module
 * table entry this half consumes is `react` (all nine baseline seeds are
 * available, but every additional one is another version-drift risk).
 *
 * Three slots are occupied:
 *
 * | slot                    | role                                              |
 * | ----------------------- | ------------------------------------------------- |
 * | `sidebar.footer.action` | the always-visible entry button beside Settings    |
 * | `shell.overlay`         | the drawer itself, plus toasts                     |
 * | `settings.section`      | the same panel inline, when Settings is enabled     |
 *
 * All three render one component over one store, so the drawer, the inline
 * page and the button can never disagree about what is being searched.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-center',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const e = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React

    /** Locale namespace; also the CSS class prefix. */
    const NS = 'dsh-skill-center'

    /* ------------------------------------------------------------------ *
     * Copy
     * ------------------------------------------------------------------ */

    const STRINGS = {
      zh: {
        nav: '技能中心',
        title: '技能中心',
        subtitle: '在全世界公开的技能注册表里发现技能，一键装到本机。',
        search: '搜索技能、仓库或关键词…',
        searchAction: '搜索',
        all: '全部',
        kind: '类型',
        category: '分类',
        sort: '排序',
        sortStars: '星标最多',
        sortDownloads: '下载最多',
        sortNewest: '最新收录',
        sortRecent: '最近更新',
        sortSkills: '技能最多',
        sortName: '按名称',
        browse: '发现',
        installedTab: '已安装',
        loading: '正在加载…',
        empty: '没有找到匹配的条目。',
        emptyHint: '换个关键词，或切换到别的来源试试。',
        searchOnly: '这个来源只能搜索：输入关键词后按回车。',
        results: '条结果',
        approximate: '（约）',
        install: '安装到本地',
        installing: '正在准备…',
        confirmInstall: '确认安装',
        cancel: '取消',
        back: '返回',
        openRepo: '打开仓库',
        files: '文件',
        size: '总大小',
        preview: '预览 SKILL.md',
        installed: '已安装',
        installTo: '安装到',
        installedOk: '已安装到',
        removedOk: '已删除',
        remove: '删除',
        removeConfirm: '确认删除这个技能？',
        revealInFolder: '位置',
        by: '作者',
        stars: '星标',
        dir: '目录',
        noDescription: '（没有描述）',
        filesCount: '个文件',
        notInstallable: '这个条目不是可直接安装的 SKILL.md 技能。',
        dshPack: '这是 DSH 插件包，用 dsh plugin add 安装。',
        error: '出错了',
        retry: '重试',
        close: '关闭',
        roots: '技能目录',
        readonly: '只读',
        source: '来源',
        detail: '详情',
        loadMore: '加载更多',
        quota: '今日剩余',
        requests: '次请求',
        tabLocal: '本机',
        trashedOk: '已移入回收站：',
        restoredOk: '已恢复：',
        undo: '撤销',
        importedOk: '已导入：',
        importedRepaired: '已导入（已修正 name）：',
        installedRepaired: '已安装（已修正 name）：',
        importAction: '导入',
        alreadyInstalled: '同名已装',
        duplicated: '重复',
        willBeIgnored: '会被忽略',
        repairable: '可自动修正',
        scanLocal: '重新扫描',
        localTitle: '本机其他 Agent 的技能',
        localHint: '这些技能已经在你硬盘上，但 DSH 不会读取它们的目录。导入是复制一份，原目录不动。',
        localHidden: '个 DSH 看不见',
        localNone: '没有发现其它 Agent 的技能目录。',
        localEmpty: '这个目录里没有技能。',
        checkUpdates: '检查更新',
        hostStale: '宿主代码还是旧版本',
        hostStaleHint: '这一屏需要重启 DeepSeek Harness 才能工作：客户端会热重载，但 lib/ 下的宿主代码只在启动时加载一次。',
        checking: '正在检查…',
        update: '更新',
        upToDate: '最新',
        updateAvailable: '有更新',
        upstreamGone: '上游已删除',
        updateUnknown: '无法检查',
        allCurrent: '已安装的技能都是最新的。',
        updateScope: '有来路记录',
        updatesFound: '个技能可以更新',
        updatedOk: '已更新：',
        updateFailed: '更新失败',
        originRemote: '来自',
        originLocal: '本地导入',
        trashTitle: '回收站',
        trashHint: '删除的技能会先放到这里，随时可以恢复。',
        trashEmpty: '回收站是空的。',
        restore: '恢复',
        purge: '彻底删除',
        purgeAll: '清空回收站',
        purgeConfirm: '彻底删除后无法恢复，确定吗？',
        inspection: '安装前体检',
        inspectionPass: '这个技能能被 DSH 正常加载。',
        inspectionBlocked: '照现在这样装上去，DSH 会直接忽略它。',
        repairLabel: '自动修正 name',
        repairHint: '只改写 SKILL.md 里的 name 字段，其余内容原样保留。',
        revisionPinned: '上游版本',
        revisionCommitted: '最后提交',
        revisionUnknown: '没能问到上游版本，这次抓的是分支当前内容。',
        integrity: '完整性',
        integrityComplete: '完整',
        integrityPartial: '部分',
        installAs: '安装为',
        installSkip: '不做任何改动',
        installReplace: '覆盖安装',
        installSkipped: '已跳过，没有改动：',
        installedRenamed: '已改名安装为：',
        installedReplaced: '已覆盖安装：',
        overwriteImport: '覆盖导入',
        conflictTitle: '这个名字已经被占用了',
        conflictSameSource: '占用它的正是同一个上游的同一个技能——覆盖等于重新安装。',
        conflictOtherSource: '占用它的是另一个技能，和这次要装的没有关系。',
        conflictOccupied: '现有来源：',
        conflictUnknownSource: '不是本插件装的（可能是你手写的）',
        conflictReplace: '覆盖',
        conflictReplaceHint: '先把现有版本完整挪到 .backup/，再写入新版本。可以手动找回。',
        conflictRename: '改名装为',
        conflictRenameHint: '现有技能一个字都不动，新技能用另一个名字并存。',
        conflictSkip: '跳过',
        conflictSkipHint: '什么都不装。想保留现在这个版本时选它。',
        partialTitle: '预览不完整',
        partialHint: '上游只取回了一部分文件，还有',
        partialFiles: ' 个文件没有检查。装上去的技能可能缺文件。',
        refsTitle: '引用了不存在的文件',
        refsMissing: '个 SKILL.md 里提到的文件不在这次取回的目录里。',
      },
      en: {
        nav: 'Skill Center',
        title: 'Skill Center',
        subtitle: 'Discover skills from public registries and install them locally.',
        search: 'Search skills, repositories or keywords…',
        searchAction: 'Search',
        all: 'All',
        kind: 'Type',
        category: 'Category',
        sort: 'Sort',
        sortStars: 'Most starred',
        sortDownloads: 'Most downloaded',
        sortNewest: 'Newest',
        sortRecent: 'Recently updated',
        sortSkills: 'Most skills',
        sortName: 'Name',
        browse: 'Discover',
        installedTab: 'Installed',
        loading: 'Loading…',
        empty: 'Nothing matched.',
        emptyHint: 'Try another keyword or switch sources.',
        searchOnly: 'This source is search-only: type a keyword and press Enter.',
        results: 'results',
        approximate: '(approx.)',
        install: 'Install locally',
        installing: 'Preparing…',
        confirmInstall: 'Confirm install',
        cancel: 'Cancel',
        back: 'Back',
        openRepo: 'Open repository',
        files: 'Files',
        size: 'Total size',
        preview: 'Preview SKILL.md',
        installed: 'Installed',
        installTo: 'Install to',
        installedOk: 'Installed to',
        removedOk: 'Removed',
        remove: 'Delete',
        removeConfirm: 'Delete this skill?',
        revealInFolder: 'Location',
        by: 'by',
        stars: 'stars',
        dir: 'path',
        noDescription: '(no description)',
        filesCount: 'files',
        notInstallable: 'This entry is not an installable SKILL.md skill.',
        dshPack: 'This is a DSH plugin package — install it with dsh plugin add.',
        error: 'Error',
        retry: 'Retry',
        close: 'Close',
        roots: 'Skill roots',
        readonly: 'read-only',
        source: 'Source',
        detail: 'Details',
        loadMore: 'Load more',
        quota: 'Left today',
        requests: 'requests',
        tabLocal: 'This machine',
        trashedOk: 'Moved to trash:',
        restoredOk: 'Restored:',
        undo: 'Undo',
        importedOk: 'Imported:',
        importedRepaired: 'Imported (name fixed):',
        installedRepaired: 'Installed (name fixed):',
        importAction: 'Import',
        alreadyInstalled: 'name taken',
        duplicated: 'duplicate',
        willBeIgnored: 'will be ignored',
        repairable: 'auto-fixable',
        scanLocal: 'Rescan',
        localTitle: "Skills in other agents' directories",
        localHint: 'These already exist on this machine, but DSH does not read their directories. Importing copies one; the original stays put.',
        localHidden: 'invisible to DSH',
        localNone: 'No other agent skill directories were found.',
        localEmpty: 'No skills in this directory.',
        checkUpdates: 'Check for updates',
        hostStale: 'The host half is an older version',
        hostStaleHint: 'This screen needs a DeepSeek Harness restart: the client hot-reloads, but the host code under lib/ is only loaded at startup.',
        checking: 'Checking…',
        update: 'Update',
        upToDate: 'Up to date',
        updateAvailable: 'Update available',
        upstreamGone: 'Gone upstream',
        updateUnknown: 'Cannot check',
        allCurrent: 'Every installed skill is up to date.',
        updateScope: 'tracked',
        updatesFound: 'skill(s) can be updated',
        updatedOk: 'Updated:',
        updateFailed: 'Update failed',
        originRemote: 'from',
        originLocal: 'local import',
        trashTitle: 'Trash',
        trashHint: 'Deleted skills land here first and can always be restored.',
        trashEmpty: 'The trash is empty.',
        restore: 'Restore',
        purge: 'Delete forever',
        purgeAll: 'Empty trash',
        purgeConfirm: 'This cannot be undone. Delete permanently?',
        inspection: 'Pre-install check',
        inspectionPass: 'DSH can load this skill as written.',
        inspectionBlocked: 'Installed as-is, DSH would ignore this skill entirely.',
        repairLabel: 'Fix the name automatically',
        repairHint: 'Rewrites only the name field in SKILL.md; everything else is copied byte for byte.',
        revisionPinned: 'Upstream revision',
        revisionCommitted: 'last commit',
        revisionUnknown: 'Could not ask for an upstream revision, so this is whatever the branch held.',
        integrity: 'Integrity',
        integrityComplete: 'Complete',
        integrityPartial: 'Partial',
        installAs: 'Install as',
        installSkip: 'Change nothing',
        installReplace: 'Replace',
        installSkipped: 'Skipped, nothing changed:',
        installedRenamed: 'Installed under a new name:',
        installedReplaced: 'Replaced:',
        overwriteImport: 'Replace import',
        conflictTitle: 'That name is already taken',
        conflictSameSource: 'The occupant is the same skill from the same upstream — replacing is a reinstall.',
        conflictOtherSource: 'The occupant is a different skill with nothing to do with this one.',
        conflictOccupied: 'Existing origin:',
        conflictUnknownSource: 'not installed by this plugin (possibly hand-written)',
        conflictReplace: 'Replace',
        conflictReplaceHint: 'Moves the current version into .backup/ intact before writing. You can put it back by hand.',
        conflictRename: 'Install as',
        conflictRenameHint: 'Leaves the existing skill untouched and keeps both under separate names.',
        conflictSkip: 'Skip',
        conflictSkipHint: 'Installs nothing. Pick this to keep the version you have.',
        partialTitle: 'Preview is incomplete',
        partialHint: 'The upstream returned only part of the tree;',
        partialFiles: ' file(s) were not checked. The installed skill may be missing files.',
        refsTitle: 'Points at files that are not there',
        refsMissing: 'file(s) named in SKILL.md are absent from the tree that was fetched.',
      },
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ *
     * Stylesheet.
     *
     * Ground rules taken from the host's own design system, which is
     * monochrome: `brand-primary` is near-black in light and near-white in
     * dark, the three `bg-layer-*` aliases are all pure white in light mode,
     * and `--dsw-alias-link` (deepseek blue) is the only chromatic accent.
     * So depth comes from borders, masks and spacing; hue is reserved for
     * emphasis.
     * ------------------------------------------------------------------ */

    const CSS = `
.sc-root, .sc-root *, .sc-drawer, .sc-drawer *, .sc-backdrop, .sc-backdrop *,
.sc-foot, .sc-foot *, .sc-toasts, .sc-toasts * { box-sizing: border-box; }

.sc-scope {
  --sc-radius: 10px;
  --sc-radius-lg: 14px;
  --sc-line: var(--dsw-alias-border-l2, rgba(127,127,127,.18));
  --sc-line-soft: var(--dsw-alias-border-l1, rgba(127,127,127,.10));
  --sc-face: var(--dsw-alias-bg-layer-2, #fff);
  /* A glass theme (dsh-plugin-wallpaper-engine and its kin) rewrites the
     the --dsw-alias-bg-layer-* aliases to color-mix(..., transparent) so the
     wallpaper shows through every host surface. This panel is a surface that
     must not, so its colour is painted over an opaque plate taken from the
     static palette, which no theme rewrites. With no glass theme the two are
     the same colour, so this changes nothing; with one, the panel stays solid.
     bg-layer-1 is bluish-00 (white) in light and bluish-875 in dark. */
  --sc-plate: var(--dsw-static-neutral-bluish-00, #fff);
  --sc-solid: linear-gradient(var(--dsw-alias-bg-layer-1, transparent), var(--dsw-alias-bg-layer-1, transparent)) var(--sc-plate);
  --sc-accent: var(--dsw-alias-link, #4176e6);
  --sc-tone: var(--dsw-alias-label-primary, #0f1115);
  --sc-tone-2: var(--dsw-alias-label-secondary, #61666b);
  --sc-tone-3: var(--dsw-alias-label-tertiary, #81858c);
  --sc-tone-4: var(--dsw-alias-label-caption, #9aa0a6);
  --sc-font: var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif);
  --sc-mono: var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  color: var(--sc-tone); font-family: var(--sc-font); font-size: 13px; line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
body[data-ds-dark-theme] .sc-scope { --sc-plate: var(--dsw-static-neutral-bluish-875, #232324); }
.sc-scope ::-webkit-scrollbar { width: 10px; height: 10px; }
.sc-scope ::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l1, rgba(127,127,127,.28));
  border: 3px solid transparent; border-radius: 999px; background-clip: content-box;
}
.sc-scope ::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l1, rgba(127,127,127,.45)); background-clip: content-box; }

.sc-backdrop {
  position: fixed; inset: 0; z-index: 2147483000;
  background: var(--dsw-alias-bg-mask-1, rgba(0,0,0,.42));
  display: flex; justify-content: flex-end;
  animation: sc-fade .16s ease-out;
}
.sc-drawer {
  position: relative; z-index: 2147483001;
  width: min(800px, 94vw); height: 100%;
  display: flex; flex-direction: column;
  background: var(--sc-solid);
  border-left: 1px solid var(--sc-line);
  box-shadow: var(--dsw-shadow-lv3, -18px 0 48px rgba(0,0,0,.18));
  animation: sc-slide .2s cubic-bezier(.22,.61,.36,1);
}
/* The root paints nothing. A surface belongs to whoever owns the screen estate:
   in the drawer that is sc-drawer below, and in the settings page it is the
   host's own panel -- the panel is a guest there. Painting one here as well drew
   a white rectangle with square corners on top of the settings dialog, square
   enough to spill past the dialog's own rounded corner. So the plate lives on
   the drawer only, and the inline panel stays see-through. */
.sc-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.sc-grow { flex: 1; min-width: 0; }

/* ---------------------------------------------------------------- header */

.sc-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px 12px; }
.sc-mark {
  flex: none; width: 30px; height: 30px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-primary-foreground, #fff);
  background: var(--dsw-alias-button-primary-fill, #0f1115);
}
.sc-title { font-size: 15px; font-weight: 600; letter-spacing: .01em; }
.sc-sub { color: var(--sc-tone-3); font-size: 12px; margin-top: 1px; }
.sc-iconbtn {
  flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  width: 30px; height: 30px; padding: 0; border-radius: 9px; cursor: pointer;
  color: var(--sc-tone-3); background: transparent; border: 1px solid transparent; font: inherit;
  transition: background .12s, color .12s;
}
.sc-iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.10)); color: var(--sc-tone); }
.sc-iconbtn.sc-danger:hover {
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236,19,19,.10));
  color: var(--dsw-alias-state-error-primary, #ec1313);
}
.sc-iconbtn[disabled] { opacity: .4; cursor: default; }

/* ------------------------------------------------------------ source rail */

.sc-tabs { display: flex; align-items: center; gap: 10px; padding: 0 20px 10px; }
.sc-seg {
  flex: none; display: inline-flex; gap: 2px; padding: 2px;
  border-radius: 999px; background: var(--dsw-alias-markdown-tag, rgba(127,127,127,.10));
}
.sc-tab {
  height: 26px; padding: 0 12px; border-radius: 999px; cursor: pointer; font: inherit;
  font-size: 12.5px; white-space: nowrap; border: none; background: transparent;
  color: var(--sc-tone-2); transition: background .12s, color .12s;
}
.sc-tab:hover { color: var(--sc-tone); }
.sc-tab.sc-on {
  color: var(--sc-tone);
  background: var(--sc-solid);
  box-shadow: var(--dsw-shadow-lv1, 0 1px 2px rgba(0,0,0,.10));
  font-weight: 500;
}
/* One row, always: the rail scrolls instead of wrapping. The right edge is
   masked so a clipped chip reads as "there is more" rather than as a bug. */
.sc-sources {
  flex: 1; min-width: 0; display: flex; gap: 6px; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none; padding: 2px 0; padding-right: 26px;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 26px), transparent);
}
.sc-sources::-webkit-scrollbar { height: 0; }
.sc-src {
  flex: none; height: 26px; padding: 0 10px; border-radius: 999px; cursor: pointer; font: inherit;
  font-size: 12px; white-space: nowrap;
  color: var(--sc-tone-2);
  background: transparent;
  border: 1px solid var(--sc-line);
  transition: background .12s, border-color .12s, color .12s;
}
.sc-src:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.10)); color: var(--sc-tone); }
.sc-src.sc-on {
  color: var(--sc-tone); font-weight: 500;
  border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent);
  background: color-mix(in srgb, var(--sc-accent) 10%, transparent);
}
.sc-src.sc-on::before {
  content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%;
  background: var(--sc-accent); margin-right: 6px; vertical-align: 1px;
}

/* ---------------------------------------------------------------- controls */

.sc-controls { display: flex; gap: 8px; padding: 0 20px 12px; align-items: center; }
.sc-field { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
.sc-field > svg { position: absolute; left: 10px; color: var(--sc-tone-4); pointer-events: none; }
.sc-input {
  width: 100%; height: 34px; padding: 0 12px 0 32px; border-radius: var(--sc-radius); font: inherit;
  font-size: 13px; color: var(--sc-tone);
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 1px solid var(--sc-line);
  outline: none; transition: border-color .12s, box-shadow .12s;
}
.sc-input::placeholder { color: var(--sc-tone-4); }
.sc-input:focus {
  border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 14%, transparent);
}
.sc-selectwrap { position: relative; flex: none; display: flex; align-items: center; }
.sc-select {
  height: 34px; padding: 0 26px 0 10px; border-radius: var(--sc-radius); font: inherit; font-size: 12.5px;
  color: var(--sc-tone-2); appearance: none; cursor: pointer; max-width: 190px;
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 1px solid var(--sc-line);
  outline: none; transition: border-color .12s;
}
.sc-select:hover { color: var(--sc-tone); }
.sc-select:focus { border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
.sc-selectwrap > svg { position: absolute; right: 8px; color: var(--sc-tone-4); pointer-events: none; }

.sc-btn {
  flex: none; height: 34px; padding: 0 14px; border-radius: var(--sc-radius); cursor: pointer; font: inherit;
  font-size: 12.5px; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
  color: var(--sc-tone); background: var(--dsw-alias-bg-layer-2, transparent);
  border: 1px solid var(--sc-line);
  transition: background .12s, border-color .12s, transform .08s;
}
.sc-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.10)); }
.sc-btn:active { transform: scale(.98); }
.sc-btn.sc-primary {
  color: var(--dsw-alias-label-primary-foreground, #fff);
  background: var(--dsw-alias-button-primary-fill, #0f1115);
  border-color: transparent; font-weight: 500;
}
.sc-btn.sc-primary:hover { background: var(--dsw-alias-button-primary-hover, #2a2a2f); }
.sc-btn.sc-danger { color: var(--dsw-alias-state-error-primary, #ec1313); }
.sc-btn.sc-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236,19,19,.10)); }
.sc-btn.sc-ghost { background: transparent; border-color: transparent; color: var(--sc-tone-3); }
.sc-btn.sc-ghost:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.10)); color: var(--sc-tone); }
.sc-btn[disabled] { opacity: .45; cursor: default; transform: none; }
.sc-btn.sc-sm { height: 30px; padding: 0 11px; }

/* ------------------------------------------------------------------ body */

.sc-body { flex: 1; min-height: 0; overflow: auto; padding: 2px 20px 20px; }
.sc-list { display: flex; flex-direction: column; gap: 7px; }

.sc-status {
  display: flex; align-items: center; gap: 8px; margin: 0 0 10px;
  color: var(--sc-tone-3); font-size: 12px;
}
.sc-status::after { content: ''; flex: 1; height: 1px; background: var(--sc-line-soft); }

/* ----------------------------------------------------------------- cards */

.sc-card {
  position: relative; display: block; width: 100%; text-align: left; cursor: pointer; font: inherit;
  padding: 12px 14px; border-radius: var(--sc-radius-lg); color: inherit;
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 1px solid var(--sc-line-soft);
  transition: border-color .13s, background .13s, box-shadow .13s, transform .13s;
}
.sc-card::before {
  content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 2px;
  border-radius: 0 2px 2px 0; background: var(--sc-accent);
  opacity: 0; transition: opacity .13s;
}
.sc-card:hover {
  border-color: var(--sc-line);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.06));
  box-shadow: var(--dsw-shadow-lv2, 0 2px 8px rgba(0,0,0,.06));
  transform: translateY(-1px);
}
.sc-card:hover::before { opacity: 1; }
.sc-cardTop { display: flex; align-items: center; gap: 10px; min-width: 0; }
.sc-avatar {
  flex: none; width: 26px; height: 26px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  color: var(--sc-tone-2); background: var(--dsw-alias-markdown-tag, rgba(127,127,127,.12));
  border: 1px solid var(--sc-line-soft);
}
.sc-name {
  font-weight: 600; font-size: 13.5px; letter-spacing: .005em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sc-metrics { flex: none; display: flex; align-items: center; gap: 10px; color: var(--sc-tone-3); font-size: 11.5px; }
.sc-metric { display: inline-flex; align-items: center; gap: 3px; font-variant-numeric: tabular-nums; }
.sc-desc {
  color: var(--sc-tone-2); font-size: 12.5px; margin-top: 5px; padding-left: 36px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.sc-meta {
  color: var(--sc-tone-3); font-size: 11.5px; margin-top: 7px; padding-left: 36px;
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
}
.sc-meta > * + *::before { content: '·'; margin-right: 8px; color: var(--sc-tone-4); }
.sc-mono { font-family: var(--sc-mono); font-size: 11.5px; text-transform: none; letter-spacing: normal; }

.sc-tag {
  flex: none; font-size: 11px; line-height: 17px; padding: 0 7px; border-radius: 6px; white-space: nowrap;
  color: var(--sc-tone-3);
  background: var(--dsw-alias-markdown-tag, rgba(127,127,127,.10));
  border: 1px solid var(--sc-line-soft);
}
.sc-tag.sc-brand {
  color: var(--sc-accent);
  background: color-mix(in srgb, var(--sc-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--sc-accent) 22%, transparent);
}
.sc-tag.sc-ok {
  color: var(--dsw-alias-state-success-primary, #16a34a);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 10%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 24%, transparent);
}
.sc-tag.sc-warn {
  color: var(--dsw-alias-state-warn-primary, #d97706);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 12%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 26%, transparent);
}

/* An explanatory line that sits beside a section heading. */
.sc-hint { flex: none; font-size: 11px; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--sc-tone-4); }

/* One validator complaint, shown inline in a row. */
.sc-problem { font-size: 11px; color: var(--dsw-alias-state-warn-primary, #d97706); }

/* A secondary block appended to a list (the trash). */
.sc-trash { margin-top: 26px; padding-top: 6px; border-top: 1px solid var(--sc-line-soft); }
.sc-group { margin-bottom: 8px; }
.sc-row.sc-dim { opacity: .72; }
.sc-row.sc-dim:hover { opacity: 1; }

/* ------------------------------------------------- pre-install inspection */

.sc-inspect {
  margin: 0 0 12px; padding: 10px 12px; border-radius: var(--sc-radius);
  border: 1px solid var(--sc-line-soft); background: var(--dsw-alias-bg-layer-2, transparent);
  font-size: 12px; line-height: 1.6;
}
.sc-inspect-bad {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 34%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 7%, transparent);
}
.sc-inspect-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.sc-inspect-head strong { font-weight: 600; }
.sc-inspect-head svg { flex: none; }
.sc-problems { margin: 6px 0 0; padding-left: 18px; color: var(--sc-tone-3); }
.sc-problems li { margin: 2px 0; }
.sc-problems-soft { color: var(--sc-tone-4); }
.sc-check { display: flex; align-items: center; gap: 7px; margin-top: 8px; cursor: pointer; }
.sc-check input { margin: 0; }
.sc-problem-code { color: var(--sc-tone-3); }
/* Three named outcomes, each with its consequence next to it. A dropdown would
   hide two of the three, and this is exactly the moment to show all of them. */
.sc-choices { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
.sc-choice {
  display: flex; align-items: baseline; gap: 7px; padding: 5px 7px;
  border-radius: 6px; cursor: pointer;
}
.sc-choice:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.07)); }
.sc-choice input { margin: 0; position: relative; top: 1px; flex: none; }
.sc-choice > span:first-of-type { font-weight: 500; }
.sc-choice-off { opacity: .45; cursor: default; }
.sc-warn-text { color: var(--dsw-alias-state-warn-primary, #d97706); }
/* Sits directly under the stats, so it reads as a footnote to them. */
.sc-revision { margin: 8px 0 0; }

/* ----------------------------------------------------------- detail block */

.sc-detailbar {
  position: sticky; top: 0; z-index: 3; margin: 0 -20px 12px; padding: 10px 20px;
  display: flex; align-items: center; gap: 8px;
  background: var(--sc-solid);
  border-bottom: 1px solid var(--sc-line-soft);
}
.sc-htitle { font-size: 19px; font-weight: 600; letter-spacing: -.01em; margin: 2px 0 8px; }
.sc-h2 {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--sc-tone-3); margin: 18px 0 8px;
}
.sc-h2::after { content: ''; flex: 1; height: 1px; background: var(--sc-line-soft); }
.sc-h2 .sc-tag { text-transform: none; letter-spacing: 0; }
.sc-lede { color: var(--sc-tone-2); font-size: 13px; margin: 0 0 10px; }
.sc-notice {
  padding: 10px 12px; border-radius: var(--sc-radius); font-size: 12.5px; margin: 0 0 12px;
  color: var(--sc-tone-2);
  background: var(--dsw-alias-markdown-tag, rgba(127,127,127,.08));
  border: 1px solid var(--sc-line-soft);
}
.sc-notice.sc-err {
  color: var(--dsw-alias-state-error-primary, #ec1313);
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236,19,19,.07));
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 30%, transparent);
}
.sc-notice.sc-inline { display: inline-flex; align-items: center; gap: 6px; margin: 0; padding: 5px 10px; }

/* ---------------------------------------------------------- code + files */

.sc-code {
  border-radius: var(--sc-radius); overflow: hidden;
  background: var(--dsw-alias-markdown-code-block, rgba(127,127,127,.07));
  border: 1px solid var(--sc-line-soft);
}
.sc-codebar {
  display: flex; align-items: center; gap: 8px; padding: 7px 12px;
  font-size: 11.5px; color: var(--sc-tone-3);
  background: var(--dsw-alias-markdown-code-block-banner, rgba(127,127,127,.06));
  border-bottom: 1px solid var(--sc-line-soft);
}
.sc-codepre {
  margin: 0; padding: 8px 0; max-height: 380px; overflow: auto;
  font-family: var(--sc-mono); font-size: 11.5px; line-height: 1.65;
  color: var(--sc-tone-2); tab-size: 2;
}
.sc-line { display: flex; padding: 0 12px; }
.sc-line:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.06)); }
.sc-lno {
  flex: none; width: 30px; text-align: right; margin-right: 12px;
  color: var(--sc-tone-4); opacity: .65; user-select: none;
  font-variant-numeric: tabular-nums;
}
.sc-lc { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }
.sc-md-head { color: var(--sc-tone); font-weight: 600; }
.sc-md-fence { color: var(--sc-tone-4); }
.sc-md-code { color: var(--sc-accent); }
.sc-md-meta { color: var(--sc-tone-3); }
.sc-md-bullet { color: var(--sc-accent); }

.sc-file {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; cursor: pointer; font: inherit;
  padding: 7px 11px; border-radius: var(--sc-radius); margin-bottom: 4px;
  color: inherit;
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 1px solid var(--sc-line-soft);
  transition: background .12s, border-color .12s;
}
.sc-file:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.07)); border-color: var(--sc-line); }
.sc-file > svg:first-child { color: var(--sc-tone-4); transition: transform .15s; }
.sc-file.sc-open > svg:first-child { transform: rotate(180deg); }
.sc-file > svg:nth-child(2) { color: var(--sc-tone-4); }
.sc-fname { flex: 1; min-width: 0; font-family: var(--sc-mono); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-fdir { color: var(--sc-tone-4); }
.sc-file .sc-tag { font-variant-numeric: tabular-nums; }

.sc-tree {
  padding: 6px; border-radius: var(--sc-radius);
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 1px solid var(--sc-line-soft);
}
.sc-treerow { display: flex; align-items: center; gap: 9px; padding: 4px 10px; border-radius: 7px; font-size: 12px; }
.sc-treerow:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.07)); }
.sc-treerow > svg { flex: none; color: var(--sc-tone-4); }
.sc-treerow.sc-dir > svg { color: var(--sc-accent); }
.sc-tree .sc-mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* -------------------------------------------------------------- summary */

.sc-stats { display: flex; gap: 8px; margin-bottom: 12px; }
.sc-stat {
  flex: 1; min-width: 0; padding: 9px 11px; border-radius: var(--sc-radius);
  background: var(--dsw-alias-markdown-tag, rgba(127,127,127,.07));
  border: 1px solid var(--sc-line-soft);
}
.sc-statk { font-size: 11px; color: var(--sc-tone-3); }
.sc-statv {
  font-size: 13px; font-weight: 600; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sc-statv.sc-mono { font-weight: 500; font-size: 11.5px; }

.sc-rows { display: flex; flex-direction: column; gap: 6px; }
.sc-row {
  display: flex; align-items: flex-start; gap: 11px; padding: 10px 12px; border-radius: var(--sc-radius);
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 1px solid var(--sc-line-soft);
  transition: border-color .12s, background .12s;
}
/* Keep the avatar level with the title, not floating beside the description. */
.sc-row .sc-avatar { margin-top: 1px; }
.sc-row:hover { border-color: var(--sc-line); background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.05)); }
.sc-row .sc-name { font-size: 13px; }
.sc-row .sc-desc { padding-left: 0; -webkit-line-clamp: 1; }
.sc-row .sc-meta { padding-left: 0; margin-top: 4px; }
.sc-row .sc-iconbtn { opacity: 0; transition: opacity .12s; }
.sc-row:hover .sc-iconbtn { opacity: 1; }
/* The trash is the one place where the icon buttons are the row's whole point,
   so they stay visible instead of waiting for a hover. */
.sc-trash .sc-row .sc-iconbtn { opacity: 1; }

/* --------------------------------------------------- loading / empty / toast */

.sc-skel { display: flex; flex-direction: column; gap: 7px; }
.sc-skelrow {
  height: 74px; border-radius: var(--sc-radius-lg);
  background: var(--dsw-alias-bg-skeleton, rgba(127,127,127,.08));
  border: 1px solid var(--sc-line-soft);
  animation: sc-pulse 1.4s ease-in-out infinite;
}
@keyframes sc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }

.sc-center { padding: 56px 16px; text-align: center; color: var(--sc-tone-3); }
.sc-center > svg { color: var(--sc-tone-4); margin-bottom: 10px; }
.sc-empty-t { font-size: 13.5px; font-weight: 600; color: var(--sc-tone-2); }
.sc-empty-h { font-size: 12px; margin-top: 3px; }

.sc-spin {
  display: inline-block; width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--sc-line); border-top-color: var(--sc-tone-2);
  animation: sc-spin .7s linear infinite; vertical-align: -3px;
}
@keyframes sc-spin { to { transform: rotate(360deg); } }
@keyframes sc-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes sc-slide { from { transform: translateX(24px); opacity: .4; } to { transform: none; opacity: 1; } }

.sc-toasts {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483002;
  display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
/* The toast chip is dark in *both* themes: --dsw-alias-toast-bg resolves to a
   bluish-750/800 either way. So its ink must not come from a flipping alias
   token — --dsw-alias-label-primary is near-black in light mode, which is how
   this shipped as black-on-black. An always-dark surface needs palette entries
   that are always light. */
.sc-toast {
  pointer-events: auto; max-width: 380px; padding: 10px 13px; border-radius: var(--sc-radius);
  font-size: 12.5px; color: var(--dsw-static-neutral-bluish-00, #fff);
  background: var(--dsw-alias-toast-bg, #353638);
  border: 1px solid rgba(255,255,255,.1);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0,0,0,.24));
  display: flex; align-items: center; gap: 8px;
  animation: sc-slide .18s ease-out;
}
.sc-toast.sc-ok > svg { color: var(--dsw-static-green-400, #4ade80); }
.sc-toast.sc-bad > svg { color: var(--dsw-static-red-400, #f87171); }
/* The undo button on a toast: the one place a destructive action is reversible.
   Same reasoning — white overlays, because the chip underneath is always dark. */
.sc-toast-act {
  flex: none; margin-left: 4px; padding: 3px 9px; border-radius: 6px; cursor: pointer;
  font: inherit; font-weight: 600; color: inherit;
  background: rgba(255,255,255,.16);
  border: 1px solid rgba(255,255,255,.22);
}
.sc-toast-act:hover { background: rgba(255,255,255,.26); }
/* The count bubble on the "this machine" tab. */
.sc-count {
  margin-left: 6px; padding: 0 5px; border-radius: 999px; font-size: 10px; line-height: 15px;
  color: var(--dsw-alias-state-warn-primary, #d97706);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 16%, transparent);
}

/* ---------------------------------------------------------- drawer footer */

.sc-foot-row {
  padding: 9px 20px; border-top: 1px solid var(--sc-line-soft);
  color: var(--sc-tone-3); font-size: 11.5px;
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
}

.sc-foot {
  display: flex; align-items: center; gap: 8px; width: 100%;
  height: 32px; padding: 0 8px; border-radius: 8px; cursor: pointer; font: inherit;
  font-size: 13px; color: var(--sc-tone-2); white-space: nowrap;
  background: transparent; border: 1px solid transparent;
  transition: background .12s, color .12s;
}
.sc-foot:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.10)); color: var(--sc-tone); }
.sc-foot.sc-rail { justify-content: center; padding: 0; }
.sc-inline { height: 100%; min-height: 320px; display: flex; flex-direction: column; }
`

    /* ------------------------------------------------------------------ *
     * Icons — inline SVG, so no primitive export can go missing under us.
     * ------------------------------------------------------------------ */

    const PATHS = {
      search: 'M10.5 3a7.5 7.5 0 1 0 4.55 13.46l3.25 3.24 1.4-1.4-3.24-3.25A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z',
      close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z',
      download: 'M11 3v10.2l-3.3-3.3-1.4 1.4L12 17l5.7-5.7-1.4-1.4L13 13.2V3h-2ZM4 19h16v2H4v-2Z',
      trash: 'M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-.9 12H6.9L6 9Zm3.1 2 .6 8h4.6l.6-8H9.1Z',
      link: 'M10.6 13.4a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 1 1 1.4 1.4l-1.4 1.4a1 1 0 0 1-1.4 0Zm-3.3 5.3a4.5 4.5 0 0 1 0-6.4l3-3 1.4 1.4-3 3a2.5 2.5 0 0 0 3.6 3.6l3-3 1.4 1.4-3 3a4.5 4.5 0 0 1-6.4 0Zm9.4-9.4-3 3-1.4-1.4 3-3a2.5 2.5 0 0 0-3.6-3.6l-3 3L7 6 10 3a4.5 4.5 0 0 1 6.4 6.4l-3 3-1.4-1.4 3-3Z',
      back: 'M11.4 4.6 5 11l6.4 6.4 1.4-1.4L8.8 12H20v-2H8.8l4-4-1.4-1.4Z',
      chevron: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z',
      check: 'M9.6 16.2 5.4 12l-1.4 1.4 5.6 5.6 12-12-1.4-1.4-10.6 10.6Z',
      spark: 'M12 2 9.6 8.6 3 11l6.6 2.4L12 20l2.4-6.6L21 11l-6.6-2.4L12 2Z',
      star: 'M12 3.2 14.7 8.9l6.3.9-4.6 4.4 1.1 6.3-5.5-2.9-5.5 2.9 1.1-6.3L3 9.8l6.3-.9L12 3.2Zm0 2.4L10 9.9l-4.7.7 3.4 3.3-.8 4.7L12 16.4l4.1 2.2-.8-4.7 3.4-3.3-4.7-.7L12 5.6Z',
      folder: 'M3 5h6.2l1.8 2H21v12H3V5Zm2 2v10h14V9h-7.8L9.4 7H5Z',
      file: 'M6 2h7l5 5v15H6V2Zm2 2v16h8V8h-4V4H8Zm6 .8V6h1.2L14 4.8Z',
      external: 'M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h5v2H7v10h10v-3h2v5H5V5Z',
      inbox: 'M4 4h16v10h-4a4 4 0 0 1-8 0H4V4Zm2 2v6h3.1a6 6 0 0 0 9.8 0H18V6H6Zm2 12h8v2H8v-2Z',
      refresh: 'M12 4a8 8 0 0 1 7.4 5H17a6 6 0 1 0-1.2 5.3l1.5 1.3A8 8 0 1 1 12 4Zm7 1v5h-5V8h3V5h2Z',
    }

    function Icon({ name: iconName, size = 15 }) {
      return e(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true', style: { flex: 'none' } },
        e('path', { d: PATHS[iconName] ?? PATHS.spark }),
      )
    }

    /* ------------------------------------------------------------------ *
     * Data access
     * ------------------------------------------------------------------ */

    /**
     * Build a request path anchored on the document's base URI.
     *
     * Root-absolute URLs break when the harness is mounted behind a reverse
     * proxy under a path prefix, which is a supported deployment.
     * @param path - API path, with or without a leading slash.
     * @returns the request path to hand to `fetch`.
     */
    function api(path) {
      const relative = String(path).replace(/^\/+/, '')
      if (typeof document === 'undefined') return `/${relative}`
      // Keep the query string: list routes carry their whole query here, and
      // resolving against `baseURI` is what makes a path-prefixed deployment
      // work. Dropping `search` would silently turn every filtered request into
      // an unfiltered one.
      const resolved = new URL(relative, document.baseURI)
      return `${resolved.pathname}${resolved.search}`
    }

    /** GET one API route, returning `undefined` instead of throwing. */
    async function getJson(route) {
      const response = await fetch(api(`/dsh-skill-center/api${route}`), { cache: 'no-store' })
      const body = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
      return body
    }

    /** POST one API route, returning `undefined` instead of throwing. */
    async function postJson(route, payload) {
      const response = await fetch(api(`/dsh-skill-center/api${route}`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
      return body
    }

    /* ------------------------------------------------------------------ *
     * Store
     * ------------------------------------------------------------------ */

    /** Fresh state for one activation. Never a module-level singleton. */
    function initialState() {
      return {
        open: false,
        tab: 'browse',
        source: 'claudeskills',
        q: '',
        kind: '',
        category: '',
        sort: '',
        page: 0,
        items: [],
        total: 0,
        exactTotal: true,
        note: '',
        loading: false,
        error: '',
        quota: undefined,
        booted: false,
        bootStarted: false,
        sources: [],
        taxonomy: { categories: [], counts: {}, totalItems: 0, uniqueRepos: 0 },
        installed: { skills: [], roots: [], counts: 0, managed: 0 },
        userRoot: '',
        detail: undefined,
        detailLoading: false,
        preview: undefined,
        previewFor: '',
        installName: '',
        /** Whether the user let us rewrite an illegal `name:` during install. */
        repair: true,
        /**
         * The answer to a name collision. Empty means "not chosen yet", which
         * resolves to the reading of the situation rather than to a fixed value.
         */
        conflict: '',
        busy: '',
        expandedFile: '',
        toasts: [],
        /** Skills found in other agents' directories, and how many DSH cannot see. */
        agents: { groups: [], hidden: 0 },
        agentsLoading: false,
        /** Set when the running host half predates this client half. */
        hostStale: false,
        /** Recoverable deletes, newest first. */
        trash: [],
        checking: false,
        updateTally: undefined,
        checkedAt: '',
      }
    }

    /** A minimal observable store shared by every slot occupant. */
    function createStore() {
      let state = initialState()
      const listeners = new Set()
      const store = {
        get() {
          return state
        },
        set(patch) {
          state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        toast(text, tone = 'ok') {
          const id = Math.random().toString(36).slice(2)
          state = { ...state, toasts: [...state.toasts, { id, text, tone }] }
          for (const listener of [...listeners]) listener()
          setTimeout(() => {
            state = { ...state, toasts: state.toasts.filter((toast) => toast.id !== id) }
            for (const listener of [...listeners]) listener()
          }, tone === 'bad' ? 6000 : 3200)
        },
        /**
         * A toast with one button on it.
         *
         * Undo is only useful while the user still remembers doing the thing,
         * so this one waits longer than a plain confirmation.
         * @param text - the message.
         * @param label - the button's label.
         * @param run - what the button does; the toast dismisses either way.
         */
        toastAction(text, label, run) {
          const id = Math.random().toString(36).slice(2)
          const dismiss = () => {
            state = { ...state, toasts: state.toasts.filter((toast) => toast.id !== id) }
            for (const listener of [...listeners]) listener()
          }
          state = {
            ...state,
            toasts: [...state.toasts, { id, text, tone: 'ok', action: { label, run: () => { dismiss(); run() } } }],
          }
          for (const listener of [...listeners]) listener()
          setTimeout(dismiss, 9000)
        },
      }
      return store
    }

    function useStore(store) {
      return useSyncExternalStore(store.subscribe, store.get, store.get)
    }

    /* ------------------------------------------------------------------ *
     * Actions
     * ------------------------------------------------------------------ */

    /** Fetch the source descriptors, taxonomy and the installed inventory. */
    async function loadBoot(store) {
      try {
        const payload = await getJson('/sources')
        store.set({
          booted: true,
          sources: payload.sources ?? [],
          taxonomy: payload.taxonomy ?? initialState().taxonomy,
          quota: payload.quota,
          installed: {
            skills: payload.installed?.skills ?? [],
            roots: payload.installed?.roots ?? [],
            counts: payload.installed?.counts ?? 0,
            managed: payload.installed?.managed ?? 0,
          },
          userRoot: payload.userRoot ?? '',
        })
      } catch (error) {
        store.set({ booted: true, error: error.message })
      }
    }

    /**
     * Load the source descriptors, the taxonomy and the first page exactly
     * once per activation, no matter how many slots mount a panel.
     * @param store - the shared store.
     */
    async function boot(store) {
      if (store.get().bootStarted) return
      store.set({ bootStarted: true })
      await loadBoot(store)
      await runQuery(store, { page: 0 })
    }

    /** Refresh the locally installed skill inventory. */
    async function loadInstalled(store) {
      try {
        const payload = await getJson('/installed')
        store.set({
          installed: {
            skills: payload.skills ?? [],
            roots: payload.roots ?? [],
            counts: (payload.skills ?? []).length,
            managed: payload.managed ?? 0,
          },
        })
      } catch {
        // the boot payload already carried an inventory; a failed refresh is quiet
      }
    }

    /** Run the current query against the active source. */
    async function runQuery(store, patch = {}) {
      const state = { ...store.get(), ...patch }
      store.set({ ...patch, loading: true, error: '' })
      const params = new URLSearchParams({
        source: state.source,
        q: state.q ?? '',
        kind: state.kind ?? '',
        category: state.category ?? '',
        sort: state.sort ?? '',
        page: String(state.page ?? 0),
        limit: '24',
      })
      try {
        const payload = await getJson(`/list?${params.toString()}`)
        store.set({
          items: payload.items ?? [],
          total: payload.total ?? 0,
          exactTotal: payload.exactTotal !== false,
          note: payload.note ?? '',
          quota: payload.quota ?? store.get().quota,
          loading: false,
        })
      } catch (error) {
        store.set({ loading: false, error: error.message, items: [], total: 0 })
      }
    }

    /** Load one entry's detail (registry record plus SKILL.md when reachable). */
    async function openDetail(store, entry) {
      store.set({ detail: { entry }, detailLoading: true, preview: undefined, expandedFile: '' })
      try {
        const payload = await postJson('/item', { entry })
        store.set({ detail: payload, detailLoading: false })
      } catch (error) {
        store.set({ detailLoading: false, error: error.message })
      }
    }

    /** Download and stage the file set for one entry, ready to install. */
    async function openPreview(store, entry) {
      store.set({ busy: 'preview', error: '' })
      try {
        const payload = await postJson('/preview', { entry })
        store.set({ preview: payload, previewFor: entry.key, installName: payload.suggestedName ?? entry.name, busy: '' })
      } catch (error) {
        store.set({ busy: '', error: error.message })
      }
    }

    /** Write the staged file set into the user skill root. */
    async function confirmInstall(store, entry, t, conflict) {
      store.set({ busy: 'install', error: '' })
      try {
        const payload = await postJson('/install', {
          entry,
          name: store.get().installName,
          repair: store.get().repair,
          ...(conflict === undefined || conflict === '' ? {} : { conflict }),
        })
        store.set({ busy: '', preview: undefined, previewFor: '', conflict: '' })
        if (payload.skipped === true) {
          store.toast(`${t('installSkipped')} ${payload.name}`, 'ok')
        } else if (payload.renamedFrom !== undefined) {
          store.toast(`${t('installedRenamed')} ${payload.name}`, 'ok')
        } else if (payload.replaced === true) {
          store.toast(`${t('installedReplaced')} ${payload.name}`, 'ok')
        } else {
          store.toast(payload.repaired ? t('installedRepaired') : `${t('installedOk')} ${payload.name}`, 'ok')
        }
        await loadInstalled(store)
        await loadBoot(store)
      } catch (error) {
        store.set({ busy: '', error: error.message })
        store.toast(error.message, 'bad')
      }
    }

    /**
     * Delete one installed skill.
     *
     * The default route is the trash, so the toast carries an undo: a delete
     * that is one keystroke away from being a mistake should be reversible
     * from the same place the mistake was made.
     */
    async function removeInstalled(store, name, confirmText, t) {
      if (typeof window !== 'undefined' && !window.confirm(`${confirmText}\n${name}`)) return
      try {
        const payload = await postJson('/remove', { name })
        const bucket = String(payload.directory ?? '').split(/[\\/]/).pop() ?? ''
        store.toastAction(`${t('trashedOk')} ${name}`, t('undo'), () => {
          void (async () => {
            try {
              await postJson('/restore', { bucket })
              store.toast(`${t('restoredOk')} ${name}`, 'ok')
            } catch (error) {
              store.toast(error.message, 'bad')
            }
            await loadInstalled(store)
            await loadTrash(store)
            await loadBoot(store)
          })()
        })
        await loadInstalled(store)
        await loadTrash(store)
        await loadBoot(store)
      } catch (error) {
        store.toast(error.message, 'bad')
      }
    }

    /** Discover skills sitting in other agents' directories. */
    /**
     * The client half hot-reloads; the host half only changes on restart. So a
     * freshly updated panel can be talking to an older host, and "no such
     * route: /agents" is a version skew, not something the user did wrong.
     */
    function isStaleHost(error) {
      return /no such route/i.test(String(error?.message ?? ''))
    }

    async function loadAgents(store) {
      store.set({ agentsLoading: true })
      try {
        const payload = await getJson('/agents')
        store.set({ agents: { groups: payload.groups ?? [], hidden: payload.hidden ?? 0 }, agentsLoading: false, hostStale: false })
      } catch (error) {
        const stale = isStaleHost(error)
        store.set({ agentsLoading: false, hostStale: stale, error: stale ? '' : error.message })
      }
    }

    /** Copy one other-agent skill into the DSH user root. */
    async function importLocal(store, group, skill, t) {
      store.set({ busy: `import:${skill.path}`, error: '' })
      try {
        // The label on the row says "覆盖导入" when the name is taken, so the
        // click has to mean exactly that — and the host still moves the version
        // it displaces into `.backup/` before writing, which is what makes a
        // one-click overwrite an acceptable thing to offer at all.
        const payload = await postJson('/import-local', {
          group: group.id,
          path: skill.path,
          repair: true,
          ...(skill.installed === true ? { conflict: 'replace' } : {}),
        })
        store.set({ busy: '' })
        if (payload.replaced === true) store.toast(`${t('installedReplaced')} ${payload.name}`, 'ok')
        else if (payload.repaired) store.toast(t('importedRepaired'), 'ok')
        else store.toast(`${t('importedOk')} ${payload.name}`, 'ok')
        await loadAgents(store)
        await loadInstalled(store)
        await loadBoot(store)
      } catch (error) {
        store.set({ busy: '' })
        store.toast(error.message, 'bad')
      }
    }

    /** Refresh the recoverable-delete list. */
    async function loadTrash(store) {
      try {
        const payload = await getJson('/trash')
        store.set({ trash: payload.items ?? [] })
      } catch {
        // a failed trash read is not worth interrupting the user for
      }
    }

    /** Put a trashed skill back where it was. */
    async function restoreTrashed(store, bucket, t) {
      try {
        const payload = await postJson('/restore', { bucket })
        store.toast(`${t('restoredOk')} ${payload.name}`, 'ok')
        await loadTrash(store)
        await loadInstalled(store)
        await loadBoot(store)
      } catch (error) {
        store.toast(error.message, 'bad')
      }
    }

    /** Delete a trashed skill for good. */
    async function purgeTrashed(store, bucket, t) {
      if (typeof window !== 'undefined' && !window.confirm(t('purgeConfirm'))) return
      try {
        await postJson('/purge', { bucket })
        await loadTrash(store)
      } catch (error) {
        store.toast(error.message, 'bad')
      }
    }

    /** Ask upstream whether any managed skill has moved on. */
    async function checkUpdates(store, t) {
      store.set({ checking: true })
      try {
        const payload = await getJson('/updates')
        store.set({ checking: false, updateTally: payload.tally, checkedAt: payload.checkedAt })
        await loadInstalled(store)
        const stale = (payload.tally?.update ?? 0) + (payload.tally?.missing ?? 0)
        // Only skills this plugin installed carry a receipt, so say how much of
        // the shelf was actually compared. "Everything is current" over a
        // checked set of one is true and misleading in the same breath.
        const fresh = store.get().installed ?? {}
        const untracked = Math.max(0, (fresh.skills?.length ?? 0) - (fresh.managed ?? 0))
        const scope = untracked > 0 ? `（${t('updateScope')} ${fresh.managed ?? 0}/${fresh.skills?.length ?? 0}）` : ''
        store.toast((stale === 0 ? t('allCurrent') : `${stale} ${t('updatesFound')}`) + scope, stale === 0 ? 'ok' : 'bad')
      } catch (error) {
        const skew = isStaleHost(error)
        store.set({ checking: false, hostStale: skew })
        store.toast(skew ? t('hostStale') : error.message, 'bad')
      }
    }

    /** Re-download one managed skill from the origin recorded at install time. */
    async function updateSkill(store, name, t) {
      store.set({ busy: `update:${name}` })
      try {
        const payload = await postJson('/update', { name })
        const result = payload.results?.[name]
        store.set({ busy: '' })
        if (result?.ok === true) {
          store.toast(`${t('updatedOk')} ${name}`, 'ok')
          await loadInstalled(store)
        } else {
          store.toast(result?.message ?? t('updateFailed'), 'bad')
        }
      } catch (error) {
        store.set({ busy: '' })
        store.toast(error.message, 'bad')
      }
    }

    /* ------------------------------------------------------------------ *
     * Components
     * ------------------------------------------------------------------ */

    /** Format a byte count for humans. */
    function bytes(value) {
      const size = Number(value) || 0
      if (size < 1024) return `${size} B`
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
      return `${(size / 1024 / 1024).toFixed(1)} MB`
    }

    /**
     * Format an ISO timestamp as a plain date.
     *
     * A commit date is a fact about the upstream, not about this session, so it
     * gets a date and no time — "最后提交 2026-09-25" answers "is this stale?"
     * and "37 minutes ago" would answer a question nobody asked.
     */
    function day(value) {
      if (typeof value !== 'string' || value === '') return ''
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
    }

    /** Format a star count compactly. */
    function compact(value) {
      const count = Number(value) || 0
      if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
      if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
      return String(count)
    }

    /** First letter of a name, for the card avatar. */
    function initial(value) {
      const text = String(value ?? '').replace(/^[^a-z0-9\u4e00-\u9fa5]+/i, '')
      return text.slice(0, 1) || '·'
    }

    /** One catalog card. */
    function Card({ entry, t, onOpen }) {
      const title = entry.title || entry.name || ''
      const metrics = []
      if (entry.installs !== undefined && Number.isFinite(entry.installs)) {
        metrics.push(e('span', { className: 'sc-metric', key: 'dl' }, e(Icon, { name: 'download', size: 12 }), compact(entry.installs)))
      }
      if (entry.stars !== undefined && Number.isFinite(entry.stars)) {
        metrics.push(e('span', { className: 'sc-metric', key: 'st' }, e(Icon, { name: 'star', size: 12 }), compact(entry.stars)))
      }
      const badge = entry.category || entry.kind
      return e(
        'button',
        { className: 'sc-card', type: 'button', onClick: () => onOpen(entry) },
        e(
          'div',
          { className: 'sc-cardTop' },
          e('span', { className: 'sc-avatar' }, initial(title)),
          e('span', { className: 'sc-name' }, title),
          e('span', { className: 'sc-grow' }),
          metrics.length > 0 ? e('span', { className: 'sc-metrics' }, ...metrics) : null,
        ),
        e('div', { className: 'sc-desc' }, entry.description || t('noDescription')),
        e(
          'div',
          { className: 'sc-meta' },
          badge ? e('span', { className: 'sc-tag sc-brand' }, badge) : null,
          e('span', null, entry.source),
          entry.repo ? e('span', { className: 'sc-mono' }, entry.repo) : null,
          entry.dir ? e('span', { className: 'sc-mono' }, entry.dir) : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * Code + tree rendering.
     * ------------------------------------------------------------------ */

    /** Lines past this many are folded, so a huge SKILL.md cannot lock the pane. */
    const CODE_LINE_LIMIT = 600

    /**
     * Classify one markdown line for the read-only code view.
     *
     * `context` is mutated so fenced blocks and the YAML frontmatter keep their
     * tone across lines. This is deliberately shallow: the goal is legibility,
     * not a markdown renderer.
     */
    function classifyLine(line, context) {
      const trimmed = line.trim()
      if (context.inFence) {
        if (trimmed.startsWith('```')) {
          context.inFence = false
          return 'sc-md-fence'
        }
        return 'sc-md-code'
      }
      if (trimmed.startsWith('```')) {
        context.inFence = true
        return 'sc-md-fence'
      }
      if (trimmed === '---') {
        context.front = !context.front
        return 'sc-md-fence'
      }
      if (context.front) return 'sc-md-meta'
      if (/^#{1,6}(\s|$)/.test(trimmed)) return 'sc-md-head'
      return ''
    }

    /** A line-numbered, lightly classified code block. */
    function CodeBlock({ text, label, meta }) {
      const source = String(text ?? '')
      const lines = useMemo(() => {
        const all = source.split('\n')
        const shown = all.slice(0, CODE_LINE_LIMIT)
        const context = { inFence: false, front: false }
        const rows = shown.map((line, index) => {
          const kind = classifyLine(line, context)
          const bullet = kind === '' ? /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/.exec(line) : null
          return { key: index, n: index + 1, text: line, kind, bullet }
        })
        return { rows, hidden: all.length - shown.length }
      }, [source])
      return e(
        'div',
        { className: 'sc-code' },
        label
          ? e(
              'div',
              { className: 'sc-codebar' },
              e(Icon, { name: 'file', size: 13 }),
              e('span', { className: 'sc-mono' }, label),
              e('span', { className: 'sc-grow' }),
              meta ? e('span', null, meta) : null,
            )
          : null,
        e(
          'pre',
          { className: 'sc-codepre' },
          ...lines.rows.map((line) =>
            e(
              'div',
              { className: 'sc-line', key: line.key },
              e('span', { className: 'sc-lno' }, line.n),
              e(
                'span',
                { className: `sc-lc ${line.kind}`.trim() },
                line.bullet
                  ? [
                      e('span', { className: 'sc-md-bullet', key: 'm' }, `${line.bullet[2]}${line.bullet[3]}`),
                      line.bullet[4],
                    ]
                  : line.text === ''
                    ? ' '
                    : line.text,
              ),
            ),
          ),
          lines.hidden > 0
            ? e('div', { className: 'sc-line' }, e('span', { className: 'sc-lno' }, '…'), e('span', { className: 'sc-lc sc-md-fence' }, `+${lines.hidden}`))
            : null,
        ),
      )
    }

    /** Fold a flat file list into indented tree rows. */
    function buildTreeRows(files, directories) {
      const root = { dirs: new Map(), files: [] }
      const ensure = (parts) => {
        let node = root
        for (const part of parts) {
          if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] })
          node = node.dirs.get(part)
        }
        return node
      }
      for (const file of files ?? []) {
        const parts = String(file).split('/').filter(Boolean)
        const name = parts.pop()
        if (name !== undefined) ensure(parts).files.push(name)
      }
      for (const dir of directories ?? []) {
        const parts = String(dir).split('/').filter(Boolean)
        if (parts.length > 0) ensure(parts)
      }
      const rows = []
      const walk = (node, depth, prefix) => {
        for (const name of [...node.dirs.keys()].sort()) {
          const path = prefix === '' ? name : `${prefix}/${name}`
          rows.push({ kind: 'dir', name, path, depth })
          walk(node.dirs.get(name), depth + 1, path)
        }
        for (const name of [...node.files].sort()) rows.push({ kind: 'file', name, path: name, depth })
      }
      walk(root, 0, '')
      return rows
    }

    /** The repository listing for a `repos` entry. */
    function FileTree({ repoDetail }) {
      const rows = useMemo(
        () => buildTreeRows(repoDetail?.files, repoDetail?.directories).slice(0, 200),
        [repoDetail],
      )
      if (rows.length === 0) return null
      return e(
        'div',
        { className: 'sc-tree' },
        ...rows.map((row) =>
          e(
            'div',
            {
              key: `${row.kind}:${row.depth}:${row.path}`,
              className: `sc-treerow${row.kind === 'dir' ? ' sc-dir' : ''}`,
              style: { paddingLeft: `${10 + row.depth * 14}px` },
            },
            e(Icon, { name: row.kind === 'dir' ? 'folder' : 'file', size: 13 }),
            e('span', { className: 'sc-mono sc-grow' }, row.kind === 'dir' ? `${row.name}/` : row.name),
          ),
        ),
      )
    }

    /** One file row inside the install preview. */
    function FileRow({ file, open, onToggle, t }) {
      const path = String(file.path ?? '')
      const cut = path.lastIndexOf('/')
      const dir = cut === -1 ? '' : path.slice(0, cut + 1)
      const base = cut === -1 ? path : path.slice(cut + 1)
      return e(
        'div',
        null,
        e(
          'button',
          { className: `sc-file${open ? ' sc-open' : ''}`, type: 'button', onClick: onToggle, title: path },
          e(Icon, { name: 'chevron', size: 14 }),
          e(Icon, { name: 'file', size: 13 }),
          e('span', { className: 'sc-fname' }, dir ? e('span', { className: 'sc-fdir' }, dir) : null, base),
          e('span', { className: 'sc-tag' }, bytes(file.bytes)),
        ),
        open ? e(CodeBlock, { text: file.preview, label: path }) : null,
      )
    }

    /* ------------------------------------------------------------------ *
     * Panes.
     * ------------------------------------------------------------------ */

    /** The install preview drawer section. */
    function PreviewPane({ store, state, t, entry }) {
      const preview = state.preview
      const busy = state.busy === 'install'
      const target = `${state.userRoot ?? ''}\\${state.installName || '…'}`
      const conflict = preview.conflict
      const choice = state.conflict !== '' ? state.conflict : defaultConflict(conflict)
      const taken = conflict?.exists === true
      return e(
        'div',
        null,
        e(
          'div',
          { className: 'sc-h2' },
          t('install'),
          preview.license ? e('span', { className: 'sc-tag' }, `license: ${preview.license}`) : null,
        ),
        e(
          'div',
          { className: 'sc-controls', style: { padding: '0 0 12px' } },
          e('input', {
            className: 'sc-input',
            style: { paddingLeft: '12px' },
            value: state.installName,
            spellCheck: false,
            onChange: (event) => store.set({ installName: event.target.value, conflict: '' }),
          }),
          e(
            'button',
            { className: 'sc-btn sc-primary', type: 'button', disabled: busy, onClick: () => confirmInstall(store, entry, t, taken ? choice : undefined) },
            busy ? e('span', { className: 'sc-spin' }) : e(Icon, { name: 'check' }),
            busy ? t('installing') : installLabel({ taken, choice, conflict, t }),
          ),
          e('button', { className: 'sc-btn sc-ghost', type: 'button', onClick: () => store.set({ preview: undefined, previewFor: '', conflict: '' }) }, t('cancel')),
        ),
        e(
          'div',
          { className: 'sc-stats' },
          e('div', { className: 'sc-stat' },
            e('div', { className: 'sc-statk' }, t('files')),
            e('div', { className: 'sc-statv' }, `${preview.files.length}`)),
          e('div', { className: 'sc-stat' },
            e('div', { className: 'sc-statk' }, t('size')),
            e('div', { className: 'sc-statv' }, bytes(preview.totalBytes))),
          e('div', { className: 'sc-stat' },
            e('div', { className: 'sc-statk' }, t('integrity')),
            e('div', { className: `sc-statv${preview.completeness?.complete === false ? ' sc-warn-text' : ''}` },
              preview.completeness?.complete === false ? t('integrityPartial') : t('integrityComplete'))),
          e('div', { className: 'sc-stat', style: { flex: '2 1 0' } },
            e('div', { className: 'sc-statk' }, t('installTo')),
            e('div', { className: 'sc-statv sc-mono', title: target }, state.installName || '…')),
        ),
        // Which revision this preview is showing. Before this line existed the
        // pane could say how many files it had but not *which* files — so two
        // people looking at the same skill page could be looking at different
        // code with no way to tell.
        RevisionLine({ preview, t }),
        // The single most useful thing this pane does: say up front whether the
        // harness will actually load what the user is about to install.
        InspectionBlock({ preview, state, store, t }),
        // Everything below is "this will install, but not the thing you think":
        // a half-fetched tree, a dangling reference, or a name already in use.
        ConflictBlock({ conflict, choice, state, store, t }),
        RiskBlock({ preview, t }),
        e(
          'div',
          null,
          ...preview.files.map((file) =>
            e(FileRow, {
              key: file.path,
              file,
              t,
              open: state.expandedFile === file.path,
              onToggle: () => store.set({ expandedFile: state.expandedFile === file.path ? '' : file.path }),
            }),
          ),
        ),
      )
    }

    /**
     * Pick the outcome the user most likely means when the name is taken.
     *
     * "Same upstream" means this is a refresh, so replacing is the plain reading
     * — and the host backs the displaced copy up first, so it stays reversible.
     * A name collision against something unrelated is not a refresh, so the
     * default moves the incoming skill aside instead of touching the incumbent.
     * @param conflict - the `/preview` conflict report, if any.
     * @returns one of `replace`, `rename`, `skip`, or `fail` when there is no clash.
     */
    function defaultConflict(conflict) {
      if (conflict?.exists !== true) return 'fail'
      if (conflict.sameSource === true) return 'replace'
      return conflict.renameTo ? 'rename' : 'skip'
    }

    /** What the primary button will actually do, spelled out. */
    function installLabel({ taken, choice, conflict, t }) {
      if (!taken) return t('confirmInstall')
      if (choice === 'skip') return t('installSkip')
      if (choice === 'replace') return t('installReplace')
      return `${t('installAs')} ${conflict?.renameTo ?? ''}`.trim()
    }

    /**
     * The three-way answer to "a skill with this name already exists".
     *
     * Never a silent overwrite and never a silent `-2`: both are surprises the
     * user only discovers later, one by losing work and the other by finding two
     * copies. The choice is stated with its consequence and the button repeats it.
     * @param input - the conflict report, the chosen outcome, and the store.
     * @returns the chooser element, or `null` when the name is free.
     */
    function ConflictBlock({ conflict, choice, state, store, t }) {
      if (conflict?.exists !== true) return null
      // The receipt stores the source id; the rail is where its human name lives.
      const occupant = (state.sources ?? []).find((descriptor) => descriptor.id === conflict.existingSource)?.label
        ?? conflict.existingSource
        ?? t('conflictUnknownSource')
      const options = [
        { value: 'replace', label: t('conflictReplace'), hint: t('conflictReplaceHint') },
        { value: 'rename', label: `${t('conflictRename')} ${conflict.renameTo ?? ''}`.trim(), hint: t('conflictRenameHint'), disabled: conflict.renameTo === undefined },
        { value: 'skip', label: t('conflictSkip'), hint: t('conflictSkipHint') },
      ]
      return e(
        'div',
        { className: 'sc-inspect sc-inspect-bad' },
        e(
          'div',
          { className: 'sc-inspect-head' },
          e(Icon, { name: 'close', size: 13 }),
          e('strong', null, t('conflictTitle')),
          e('span', { className: 'sc-hint' }, conflict.sameSource === true ? t('conflictSameSource') : t('conflictOtherSource')),
        ),
        e('div', { className: 'sc-mono sc-hint' }, `${t('conflictOccupied')} ${occupant}`),
        e(
          'div',
          { className: 'sc-choices' },
          ...options.map((option) =>
            e(
              'label',
              { key: option.value, className: `sc-choice${option.disabled === true ? ' sc-choice-off' : ''}` },
              e('input', {
                type: 'radio',
                name: 'skill-center-conflict',
                value: option.value,
                checked: choice === option.value,
                disabled: option.disabled === true,
                onChange: () => store.set({ conflict: option.value }),
              }),
              e('span', null, option.label),
              e('span', { className: 'sc-hint' }, option.hint),
            ),
          ),
        ),
      )
    }

    /**
     * What the preview cannot vouch for: a truncated fetch, or a SKILL.md that
     * points at files nobody shipped.
     *
     * Both are invisible after installation — the skill looks fine in every list
     * and only fails the first time the model actually tries to use it.
     * @param input - the staged preview and the translator.
     * @returns the warnings element, or `null` when there is nothing to warn about.
     */
    function RiskBlock({ preview, t }) {
      const shape = preview.completeness
      const refs = preview.references
      const partial = shape?.complete === false
      const missing = (refs?.missingCount ?? 0) > 0
      if (!partial && !missing) return null
      return e(
        'div',
        { className: 'sc-inspect sc-inspect-bad' },
        partial
          ? e(
              'div',
              null,
              e(
                'div',
                { className: 'sc-inspect-head' },
                e(Icon, { name: 'close', size: 13 }),
                e('strong', null, t('partialTitle')),
                e('span', { className: 'sc-hint' }, `${t('partialHint')} ${shape.skippedCount ?? 0}${t('partialFiles')}`),
              ),
              (shape.reasons ?? []).length > 0
                ? e('ul', { className: 'sc-problems' }, ...shape.reasons.map((reason, index) => e('li', { key: index }, `${reason.message}（${reason.count}）`)))
                : null,
            )
          : null,
        missing
          ? e(
              'div',
              null,
              e(
                'div',
                { className: 'sc-inspect-head' },
                e(Icon, { name: 'close', size: 13 }),
                e('strong', null, t('refsTitle')),
                e('span', { className: 'sc-hint' }, `${refs.missingCount} ${t('refsMissing')}`),
              ),
              e('ul', { className: 'sc-problems' }, ...refs.missing.map((reference, index) => e('li', { key: index }, e('code', { className: 'sc-mono' }, reference.path)))),
            )
          : null,
      )
    }

    /**
     * Which upstream revision this preview was read from.
     *
     * The whole point of reading a skill at a commit rather than at a branch is
     * that the answer cannot change under you — so the pane has to name it, or
     * the guarantee is invisible. When the revision could not be resolved the
     * line says so instead of staying silent, because "we read the branch, and
     * branches move" is a real difference in what the user is getting.
     * @param input - the staged preview and the translator.
     * @returns the line element, or null when the source has no revision.
     */
    function RevisionLine({ preview, t }) {
      const revision = preview.revision
      if (revision === undefined || revision === null) return null
      const date = day(revision.committedAt)
      if (revision.commit === undefined || revision.commit === null) {
        return e('div', { className: 'sc-hint sc-revision' }, e('span', { className: 'sc-warn-text' }, t('revisionUnknown')))
      }
      return e(
        'div',
        { className: 'sc-hint sc-revision' },
        t('revisionPinned'),
        ' ',
        e('code', { className: 'sc-mono', title: revision.commit }, revision.commit.slice(0, 7)),
        date === '' ? null : ` · ${t('revisionCommitted')} ${date}`,
      )
    }

    /**
     * The pre-install verdict: what the harness will think of this document.
     *
     * A skill whose `name:` is illegal is silently skipped by the harness's
     * loader, so installing it looks like success and produces nothing. This
     * block is where that is said out loud, with the fix offered inline.
     * @param input - the staged preview, the store, and the translator.
     * @returns the block element.
     */
    function InspectionBlock({ preview, state, store, t }) {
      const report = preview.inspection
      if (report === undefined || report === null) return null
      const errors = (report.problems ?? []).filter((problem) => problem.level === 'error')
      const warnings = (report.problems ?? []).filter((problem) => problem.level === 'warn')
      const blocked = report.blocked === true
      return e(
        'div',
        { className: `sc-inspect${blocked ? ' sc-inspect-bad' : ''}` },
        e(
          'div',
          { className: 'sc-inspect-head' },
          e(Icon, { name: blocked ? 'close' : 'check', size: 13 }),
          e('strong', null, t('inspection')),
          e('span', { className: 'sc-hint' }, blocked ? t('inspectionBlocked') : t('inspectionPass')),
        ),
        errors.length > 0
          ? e('ul', { className: 'sc-problems' }, ...errors.map((problem, index) => e('li', { key: index }, problem.message)))
          : null,
        warnings.length > 0
          ? e('ul', { className: 'sc-problems sc-problems-soft' }, ...warnings.map((problem, index) => e('li', { key: index }, problem.message)))
          : null,
        blocked && report.repairable
          ? e(
              'label',
              { className: 'sc-check' },
              e('input', {
                type: 'checkbox',
                checked: state.repair !== false,
                onChange: (event) => store.set({ repair: event.target.checked }),
              }),
              e('span', null, t('repairLabel')),
              e('span', { className: 'sc-hint' }, t('repairHint')),
            )
          : null,
      )
    }

    /** The detail view for one catalog entry. */
    function DetailPane({ store, state, t }) {
      const entry = state.detail?.entry ?? {}
      const skillText = state.detail?.skillText
      const repoDetail = state.detail?.repoDetail
      const canInstall = entry.installable !== false && Boolean(entry.url)
      const staging = state.busy === 'preview'
      const title = entry.title || entry.name || ''
      return e(
        'div',
        null,
        e(
          'div',
          { className: 'sc-detailbar' },
          e(
            'button',
            { className: 'sc-btn sc-ghost sc-sm', type: 'button', onClick: () => store.set({ detail: undefined, preview: undefined }) },
            e(Icon, { name: 'back' }),
            t('back'),
          ),
          e('span', { className: 'sc-grow' }),
          entry.url
            ? e('a', { className: 'sc-btn sc-sm', href: entry.url, target: '_blank', rel: 'noreferrer' },
                e(Icon, { name: 'external', size: 13 }), t('openRepo'))
            : null,
          canInstall
            ? e(
                'button',
                { className: 'sc-btn sc-primary sc-sm', type: 'button', disabled: staging, onClick: () => openPreview(store, entry) },
                e(Icon, { name: 'download', size: 13 }),
                staging ? t('installing') : t('install'),
              )
            : null,
        ),
        e('div', { className: 'sc-htitle' }, title),
        e(
          'div',
          { className: 'sc-meta', style: { paddingLeft: 0, marginTop: 0, marginBottom: '10px' } },
          e('span', { className: 'sc-tag sc-brand' }, entry.category || entry.kind || entry.source),
          entry.category && entry.kind ? e('span', { className: 'sc-tag' }, entry.kind) : null,
          e('span', { className: 'sc-tag' }, entry.source),
          entry.author ? e('span', null, `${t('by')} ${entry.author}`) : null,
          entry.stars !== undefined ? e('span', { className: 'sc-metric' }, e(Icon, { name: 'star', size: 12 }), compact(entry.stars)) : null,
          entry.installs !== undefined ? e('span', { className: 'sc-metric' }, e(Icon, { name: 'download', size: 12 }), compact(entry.installs)) : null,
          entry.repo ? e('span', { className: 'sc-mono' }, entry.repo) : null,
        ),
        e('p', { className: 'sc-lede' }, entry.description || t('noDescription')),
        entry.installable === false
          ? e('p', { className: 'sc-notice' }, entry.source === 'dsh' ? t('dshPack') : t('notInstallable'))
          : null,
        state.error ? e('p', { className: 'sc-notice sc-err' }, state.error) : null,
        state.detailLoading
          ? e('div', { className: 'sc-skel' }, e('div', { className: 'sc-skelrow', style: { height: '180px' } }))
          : null,
        state.previewFor === entry.key && state.preview ? e(PreviewPane, { store, state, t, entry }) : null,
        repoDetail
          ? e(
              'div',
              null,
              e(
                'div',
                { className: 'sc-h2' },
                t('files'),
                e('span', { className: 'sc-mono' }, `${repoDetail.repo ?? ''}/${repoDetail.path ?? ''}`),
              ),
              e(FileTree, { repoDetail }),
            )
          : null,
        skillText
          ? e(
              'div',
              null,
              e('div', { className: 'sc-h2' }, t('preview'), e('span', { className: 'sc-mono' }, 'SKILL.md')),
              e(CodeBlock, { text: skillText }),
            )
          : null,
      )
    }

    /**
     * Turn a stored update verdict into a badge.
     * @param skill - one installed-skill record, with its receipt attached.
     * @param t - translator.
     * @returns the badge element, or `null` when there is nothing to say.
     */
    function UpdateBadge({ skill, t }) {
      const status = skill.provenance?.update?.status
      if (status === 'update') return e('span', { className: 'sc-tag sc-warn' }, t('updateAvailable'))
      if (status === 'missing') return e('span', { className: 'sc-tag sc-warn' }, t('upstreamGone'))
      // A skill with no receipt was not installed by us, so "current" would be
      // a claim we cannot make; silence is the honest answer.
      if (status === 'current') return e('span', { className: 'sc-tag sc-ok' }, t('upToDate'))
      if (status === 'unknown') return e('span', { className: 'sc-tag' }, t('updateUnknown'))
      return null
    }

    /**
     * Where an installed skill came from, in one line.
     * @param skill - one installed-skill record.
     * @param t - translator.
     * @returns a short description.
     */
    function originOf(skill, t) {
      const record = skill.provenance
      if (record === undefined || record === null) return undefined
      if (record.origin === 'local') return `${t('originLocal')} · ${record.fromLabel ?? ''}`.trim()
      const base = `${t('originRemote')} ${record.source ?? ''}`.trim()
      // The revision is part of where a skill came from: two installs of the
      // same name a week apart are different code, and this line is the only
      // place that says which of them is on disk.
      return typeof record.commit === 'string' && record.commit !== ''
        ? `${base} · ${record.commit.slice(0, 7)}`
        : base
    }

    /** The installed-skill inventory, plus the recoverable-delete list. */
    function InstalledPane({ store, state, t }) {
      const skills = state.installed.skills ?? []
      const roots = state.installed.roots ?? []
      const trash = state.trash ?? []
      const managed = skills.filter((skill) => skill.source === 'user-dsh')
      return e(
        'div',
        null,
        e(
          'div',
          { className: 'sc-h2' },
          t('installed'),
          e('span', { className: 'sc-tag' }, `${skills.length}`),
          managed.length > 0 && state.hostStale !== true
            ? e(
                'button',
                { className: 'sc-btn sc-ghost sc-sm', type: 'button', disabled: state.checking, onClick: () => void checkUpdates(store, t) },
                e(Icon, { name: 'refresh', size: 13 }),
                state.checking ? t('checking') : t('checkUpdates'),
              )
            : null,
        ),
        e(
          'div',
          { className: 'sc-status' },
          ...roots.map((root) =>
            e('span', { key: root.path, className: 'sc-tag' },
              `${root.label}${root.writable ? '' : ` · ${t('readonly')}`}`),
          ),
        ),
        skills.length === 0
          ? e('div', { className: 'sc-center' }, e(Icon, { name: 'inbox', size: 26 }),
              e('div', { className: 'sc-empty-t' }, t('empty')),
              e('div', { className: 'sc-empty-h' }, t('emptyHint')))
          : e(
              'div',
              { className: 'sc-rows' },
              ...skills.map((skill) => {
                const status = skill.provenance?.update?.status
                const origin = originOf(skill, t)
                const writable = skill.source === 'user-dsh'
                return e(
                  'div',
                  { className: 'sc-row', key: `${skill.source}/${skill.name}` },
                  e('span', { className: 'sc-avatar' }, initial(skill.name)),
                  e(
                    'div',
                    { className: 'sc-grow' },
                    e('div', { className: 'sc-name' }, skill.name),
                    e('div', { className: 'sc-desc' }, skill.description || t('noDescription')),
                    e(
                      'div',
                      { className: 'sc-meta' },
                      e('span', { className: 'sc-tag sc-brand' }, skill.source),
                      origin ? e('span', null, origin) : null,
                      e('span', null, `${skill.fileCount ?? 0} ${t('filesCount')}`),
                      e('span', null, bytes(skill.bytes)),
                      skill.valid === false ? e('span', { className: 'sc-tag sc-warn' }, t('willBeIgnored')) : null,
                      UpdateBadge({ skill, t }),
                    ),
                  ),
                  writable && status === 'update'
                    ? e(
                        'button',
                        { className: 'sc-btn sc-sm', type: 'button', disabled: state.busy === `update:${skill.name}`,
                          onClick: () => void updateSkill(store, skill.name, t) },
                        e(Icon, { name: 'download', size: 12 }),
                        t('update'),
                      )
                    : null,
                  writable
                    ? e(
                        'button',
                        { className: 'sc-iconbtn sc-danger', type: 'button', title: t('remove'),
                          onClick: () => void removeInstalled(store, skill.name, t('removeConfirm'), t) },
                        e(Icon, { name: 'trash' }),
                      )
                    : null,
                )
              }),
            ),
        trash.length > 0
          ? e(
              'div',
              { className: 'sc-trash' },
              e(
                'div',
                { className: 'sc-h2' },
                t('trashTitle'),
                e('span', { className: 'sc-tag' }, `${trash.length}`),
                e('span', { className: 'sc-hint' }, t('trashHint')),
                e(
                  'button',
                  { className: 'sc-btn sc-ghost sc-sm', type: 'button', onClick: () => void purgeTrashed(store, '', t) },
                  t('purgeAll'),
                ),
              ),
              ...trash.map((item) =>
                e(
                  'div',
                  { className: 'sc-row sc-dim', key: item.bucket },
                  e('span', { className: 'sc-avatar' }, initial(item.name)),
                  e(
                    'div',
                    { className: 'sc-grow' },
                    e('div', { className: 'sc-name' }, item.name),
                    e(
                      'div',
                      { className: 'sc-meta' },
                      e('span', { className: 'sc-tag' }, item.source ?? t('originLocal')),
                      item.trashedAt ? e('span', null, new Date(item.trashedAt).toLocaleString()) : null,
                      e('span', null, bytes(item.bytes)),
                      // Promising a clean restore is only honest when the
                      // receipt actually rode along in the bucket.
                      item.managed ? e('span', { className: 'sc-tag sc-ok' }, t('upToDate')) : null,
                    ),
                  ),
                  e(
                    'button',
                    { className: 'sc-btn sc-sm', type: 'button', onClick: () => void restoreTrashed(store, item.bucket, t) },
                    e(Icon, { name: 'back', size: 12 }),
                    t('restore'),
                  ),
                  e(
                    'button',
                    { className: 'sc-iconbtn sc-danger', type: 'button', title: t('purge'), onClick: () => void purgeTrashed(store, item.bucket, t) },
                    e(Icon, { name: 'close' }),
                  ),
                ),
              ),
            )
          : null,
      )
    }

    /** Skills that already exist on this machine under another agent. */
    function LocalPane({ store, state, t }) {
      const groups = state.agents.groups ?? []
      const present = groups.filter((group) => group.exists)
      if (state.hostStale === true) {
        return e('div', { className: 'sc-center' }, e(Icon, { name: 'inbox', size: 26 }),
          e('div', { className: 'sc-empty-t' }, t('hostStale')),
          e('div', { className: 'sc-empty-h' }, t('hostStaleHint')))
      }
      if (state.agentsLoading && groups.length === 0) {
        return e('div', { className: 'sc-skel' }, ...Array.from({ length: 3 }, (_, index) => e('div', { key: index, className: 'sc-skelrow' })))
      }
      if (present.length === 0) {
        return e('div', { className: 'sc-center' }, e(Icon, { name: 'inbox', size: 26 }),
          e('div', { className: 'sc-empty-t' }, t('localNone')),
          e('div', { className: 'sc-empty-h' }, t('localHint')))
      }
      return e(
        'div',
        null,
        e(
          'div',
          { className: 'sc-h2' },
          t('localTitle'),
          e('span', { className: 'sc-hint' }, t('localHint')),
          e(
            'button',
            { className: 'sc-btn sc-ghost sc-sm', type: 'button', disabled: state.agentsLoading, onClick: () => void loadAgents(store) },
            e(Icon, { name: 'refresh', size: 13 }),
            state.agentsLoading ? t('checking') : t('scanLocal'),
          ),
        ),
        ...present.map((group) =>
          e(
            'div',
            { className: 'sc-group', key: group.id },
            e(
              'div',
              { className: 'sc-h2' },
              group.label,
              e('span', { className: 'sc-tag' }, `${group.skills.length}`),
              group.visible ? e('span', { className: 'sc-tag sc-ok' }, t('upToDate')) : null,
              e('span', { className: 'sc-mono' }, group.path),
            ),
            group.skills.length === 0
              ? e('div', { className: 'sc-status' }, t('localEmpty'))
              : e(
                  'div',
                  { className: 'sc-rows' },
                  ...group.skills.map((skill) =>
                    e(
                      'div',
                      { className: 'sc-row', key: skill.path },
                      e('span', { className: 'sc-avatar' }, initial(skill.name)),
                      e(
                        'div',
                        { className: 'sc-grow' },
                        e('div', { className: 'sc-name' }, skill.name),
                        e('div', { className: 'sc-desc' }, skill.description || t('noDescription')),
                        e(
                          'div',
                          { className: 'sc-meta' },
                          skill.installed ? e('span', { className: 'sc-tag sc-ok' }, t('alreadyInstalled')) : null,
                          skill.duplicateOf ? e('span', { className: 'sc-tag sc-warn' }, t('duplicated')) : null,
                          skill.valid === false
                            ? e('span', { className: 'sc-tag sc-warn' }, skill.repairable ? t('repairable') : t('willBeIgnored'))
                            : null,
                          // Show what the validator objected to; a bare "invalid"
                          // tells the user nothing they can act on.
                          ...(skill.valid === false ? skill.problems.filter((problem) => problem.level === 'error').map((problem, index) => e('span', { key: index, className: 'sc-problem' }, problem.message)) : []),
                          e('span', null, bytes(skill.bytes)),
                          e('span', { className: 'sc-mono' },
                            skill.flat ? skill.path.split(/[\\/]/).pop() : 'SKILL.md'),
                        ),
                      ),
                      e(
                        'button',
                        { className: `sc-btn sc-sm${skill.installed ? ' sc-danger' : ''}`, type: 'button',
                          disabled: state.busy === `import:${skill.path}` || (skill.valid === false && !skill.repairable),
                          title: skill.valid === false && !skill.repairable
                            ? t('inspectionBlocked')
                            : skill.installed ? t('conflictReplaceHint') : undefined,
                          onClick: () => void importLocal(store, group, skill, t) },
                        e(Icon, { name: 'download', size: 12 }),
                        // The label states the outcome: importing over a name DSH
                        // already has is a different act from a first import, and
                        // the button should not be the place that hides it.
                        skill.installed ? t('overwriteImport') : t('importAction'),
                      ),
                    ),
                  ),
                ),
          ),
        ),
      )
    }

    /** The whole panel: header, controls, and the active view. */
    function Panel({ store, mode, t }) {
      const state = useStore(store)
      const inputRef = useRef(null)

      useEffect(() => {
        void boot(store)
      }, [store])

      // Escape is handled once, in apply(), where it can unwind the preview and
      // the detail before closing the drawer. A second listener here would fire
      // alongside it and close the whole drawer on the first press.

      const source = useMemo(
        () => (state.sources ?? []).find((descriptor) => descriptor.id === state.source),
        [state.sources, state.source],
      )
      const searchOnly = source?.searchOnly === true
      const kinds = source?.kinds ?? []
      const sorts = source?.sorts ?? []
      const categories = state.taxonomy?.categories ?? []

      const onSearch = useCallback(() => {
        void runQuery(store, { page: 0 })
      }, [store])

      // The close button deliberately sits on the LEFT. In the desktop app the
      // drawer header runs right up under the OS titlebar, so a top-right ✕
      // lands within a few pixels of the window's own close button — one
      // mis-click away from quitting the whole app.
      const head = e(
        'div',
        { className: 'sc-head' },
        mode === 'drawer'
          ? e('button',
              { className: 'sc-iconbtn', type: 'button', title: `${t('close')} · Esc`,
                onClick: () => store.set({ open: false }) },
              e(Icon, { name: 'close' }))
          : null,
        e('span', { className: 'sc-mark' }, e(Icon, { name: 'spark', size: 16 })),
        e(
          'div',
          { className: 'sc-grow' },
          e('div', { className: 'sc-title' }, t('title')),
          e('div', { className: 'sc-sub' }, t('subtitle')),
        ),
      )

      // The view switch and the source rail are different kinds of choice, so
      // they get different controls: a segmented toggle, then a scrolling row.
      const tabs = e(
        'div',
        { className: 'sc-tabs' },
        e(
          'div',
          { className: 'sc-seg' },
          e(
            'button',
            { className: `sc-tab${state.tab === 'browse' ? ' sc-on' : ''}`, type: 'button', onClick: () => store.set({ tab: 'browse' }) },
            t('browse'),
          ),
          e(
            'button',
            { className: `sc-tab${state.tab === 'installed' ? ' sc-on' : ''}`, type: 'button', onClick: () => { store.set({ tab: 'installed' }); void loadInstalled(store); void loadTrash(store) } },
            `${t('installedTab')} ${state.installed.counts ?? 0}`,
          ),
          e(
            'button',
            { className: `sc-tab${state.tab === 'local' ? ' sc-on' : ''}`, type: 'button', title: t('localTitle'), onClick: () => { store.set({ tab: 'local' }); if ((state.agents?.groups ?? []).length === 0) void loadAgents(store) } },
            t('tabLocal'),
            state.agents?.hidden > 0 ? e('span', { className: 'sc-count' }, `${state.agents.hidden}`) : null,
          ),
        ),
        state.tab === 'browse' && !state.detail
          ? e(
              'div',
              { className: 'sc-sources' },
              ...(state.sources ?? []).map((descriptor) =>
                e(
                  'button',
                  {
                    key: descriptor.id,
                    className: `sc-src${state.source === descriptor.id ? ' sc-on' : ''}`,
                    type: 'button',
                    title: descriptor.note ?? '',
                    onClick: () => {
                      const kind = (descriptor.kinds ?? [])[0]?.id ?? ''
                      const sort = (descriptor.sorts ?? [])[0] ?? ''
                      store.set({ tab: 'browse', source: descriptor.id, kind, sort, category: '', page: 0, detail: undefined })
                      void runQuery(store, { source: descriptor.id, kind, sort, category: '', page: 0 })
                    },
                  },
                  descriptor.label,
                ),
              ),
            )
          : null,
      )

      const controls = e(
        'div',
        { className: 'sc-controls' },
        e(
          'div',
          { className: 'sc-field' },
          e(Icon, { name: 'search', size: 14 }),
          e('input', {
            ref: inputRef,
            className: 'sc-input',
            placeholder: searchOnly ? t('searchOnly') : t('search'),
            value: state.q,
            spellCheck: false,
            onChange: (event) => store.set({ q: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === 'Enter') onSearch()
            },
          }),
        ),
        e('button', { className: 'sc-btn sc-primary', type: 'button', onClick: onSearch }, t('searchAction')),
        kinds.length > 1
          ? e(
              'div',
              { className: 'sc-selectwrap' },
              e(
                'select',
                { className: 'sc-select', value: state.kind, onChange: (event) => { store.set({ kind: event.target.value, page: 0 }); void runQuery(store, { kind: event.target.value, page: 0 }) } },
                e('option', { value: '' }, `${t('kind')}: ${t('all')}`),
                ...kinds.map((kind) => e('option', { key: kind.id, value: kind.id }, kind.label)),
              ),
              e(Icon, { name: 'chevron', size: 13 }),
            )
          : null,
        categories.length > 0 && state.source === 'claudeskills'
          ? e(
              'div',
              { className: 'sc-selectwrap' },
              e(
                'select',
                { className: 'sc-select', value: state.category, onChange: (event) => { store.set({ category: event.target.value, page: 0 }); void runQuery(store, { category: event.target.value, page: 0 }) } },
                e('option', { value: '' }, `${t('category')}: ${t('all')}`),
                ...categories.map((category) => e('option', { key: category, value: category }, category)),
              ),
              e(Icon, { name: 'chevron', size: 13 }),
            )
          : null,
        sorts.length > 1
          ? e(
              'div',
              { className: 'sc-selectwrap' },
              e(
                'select',
                { className: 'sc-select', value: state.sort, onChange: (event) => { store.set({ sort: event.target.value, page: 0 }); void runQuery(store, { sort: event.target.value, page: 0 }) } },
                ...sorts.map((sort) => e('option', { key: sort, value: sort }, `${t('sort')}: ${t(`sort${sort[0].toUpperCase()}${sort.slice(1)}`)}`)),
              ),
              e(Icon, { name: 'chevron', size: 13 }),
            )
          : null,
      )

      const body = e(
        'div',
        { className: 'sc-body' },
        state.error ? e('p', { className: 'sc-notice sc-err' }, `${t('error')}: ${state.error}`) : null,
        state.note && state.tab === 'browse' && !state.detail ? e('div', { className: 'sc-status' }, state.note) : null,
        state.tab === 'installed'
          ? e(InstalledPane, { store, state, t })
          : state.tab === 'local'
            ? e(LocalPane, { store, state, t })
            : state.detail
              ? e(DetailPane, { store, state, t })
              : state.loading
                ? e('div', { className: 'sc-skel' },
                    e('div', { className: 'sc-skelrow' }),
                    e('div', { className: 'sc-skelrow' }),
                    e('div', { className: 'sc-skelrow' }),
                    e('div', { className: 'sc-skelrow' }))
                : state.items.length === 0
                  ? e('div', { className: 'sc-center' },
                      e(Icon, { name: 'inbox', size: 26 }),
                      e('div', { className: 'sc-empty-t' }, t('empty')),
                      e('div', { className: 'sc-empty-h' }, t('emptyHint')))
                  : e(
                      'div',
                      { className: 'sc-list' },
                      ...state.items.map((entry) => e(Card, { key: entry.key, entry, t, onOpen: (target) => openDetail(store, target) })),
                      state.items.length >= 24
                        ? e(
                            'button',
                            { className: 'sc-btn', type: 'button', style: { justifyContent: 'center', marginTop: '6px' },
                              onClick: () => { const next = (state.page ?? 0) + 1; store.set({ page: next }); void runQuery(store, { page: next }) } },
                            t('loadMore'),
                          )
                        : null,
                    ),
      )

      const footer = e(
        'div',
        { className: 'sc-foot-row' },
        state.tab === 'browse'
          ? e('span', null, `${state.total} ${state.exactTotal ? '' : `${t('approximate')} `}${t('results')}`)
          : state.tab === 'local'
            ? e('span', null, `${state.agents?.hidden ?? 0} ${t('localHidden')}`)
            : e('span', null, `${(state.installed.skills ?? []).length} ${t('filesCount')}`),
        state.tab === 'browse' && !state.detail ? e('span', null, source?.label ?? state.source) : null,
        state.checkedAt !== '' && state.tab === 'installed'
          ? e('span', null, `${t('checkUpdates')} ${new Date(state.checkedAt).toLocaleTimeString()}`)
          : null,
        state.quota?.dailyRemaining !== undefined
          ? e('span', null, `SkillsMP ${t('quota')} ${state.quota.dailyRemaining}/${state.quota.dailyLimit ?? '?'} ${t('requests')}`)
          : null,
      )

      return e('div', { className: `sc-root sc-scope${mode === 'inline' ? ' sc-inline' : ''}` }, head, tabs, state.tab === 'browse' && !state.detail ? controls : null, body, footer)
    }

    /** Toasts ride the overlay so they survive the drawer closing. */
    function Toasts({ store }) {
      const state = useStore(store)
      if (state.toasts.length === 0) return null
      return e('div', { className: 'sc-toasts sc-scope' }, ...state.toasts.map((toast) =>
        e('div', { key: toast.id, className: `sc-toast${toast.tone === 'bad' ? ' sc-bad' : ' sc-ok'}` },
          e(Icon, { name: toast.tone === 'bad' ? 'close' : 'check', size: 14 }),
          e('span', { className: 'sc-grow' }, toast.text),
          toast.action
            ? e('button', { className: 'sc-toast-act', type: 'button', onClick: toast.action.run }, toast.action.label)
            : null)))
    }

    /** The drawer plus the toast stack, occupying `shell.overlay`. */
    function Overlay({ store, t }) {
      const state = useStore(store)
      return e(
        React.Fragment,
        null,
        state.open
          ? e(
              'div',
              {
                className: 'sc-backdrop sc-scope',
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) store.set({ open: false })
                },
              },
              e('div', { className: 'sc-drawer' }, e(Panel, { store, mode: 'drawer', t })),
            )
          : null,
        e(Toasts, { store }),
      )
    }

    /** The sidebar-foot button. */
    function FooterAction({ store, t, wide }) {
      return e(
        'button',
        {
          className: `sc-foot sc-scope${wide ? '' : ' sc-rail'}`,
          type: 'button',
          title: t('nav'),
          onClick: () => store.set({ open: true }),
        },
        e(Icon, { name: 'spark', size: 16 }),
        wide ? e('span', null, t('nav')) : null,
      )
    }

    /* ------------------------------------------------------------------ *
     * Plugin body
     * ------------------------------------------------------------------ */

    /**
     * The tag id this bundle's stylesheet is registered under. Unique per
     * bundle, and the key the re-injection guard below matches on.
     */
    const STYLE_TAG_ID = `${NS}/client.css`

    /**
     * Register the plugin's stylesheet, the way the host's own bundles do.
     *
     * Both attributes are load-bearing, and neither is decoration:
     *
     * - The host's module loader (`@deepseek-ai/dsh-client-modules`) claims
     *   every UNTAGGED `<style>` for whichever plugin materializes next. This
     *   bundle injects its tag from `apply()`, which runs after its own
     *   materialization, so an untagged tag is still untagged when the next
     *   plugin boots -- and gets claimed by it.
     * - The host's hot reloader (`@deepseek-ai/dsh-client-hmr`) then deletes
     *   `style[data-plugin=<that other plugin>]` whenever that plugin is
     *   rebuilt. Once our tag has been claimed, updating somebody else's plugin
     *   takes this stylesheet down while this panel stays mounted: the DOM is
     *   all there, styled by nothing, which reads as a scrambled interface.
     *   `data-plugin` is what makes the tag ours and stops that handover.
     * - `data-plugin-css` is the unique tag id, and the guard keys on it, so a
     *   second activation adds nothing instead of stacking a second copy.
     *
     * The tag is deliberately never removed. That is what the host's bundles do,
     * and it is the honest lifetime: this stylesheet belongs to the document,
     * not to a fiber, so a teardown that leaves the panel mounted cannot strip
     * the panel bare.
     */
    function attachStyles() {
      const head = document.head ?? document.documentElement
      if (head === null || head === undefined) return () => {}
      const selector = `style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`
      if (typeof document.querySelector === 'function' && document.querySelector(selector) !== null) return () => {}
      const style = document.createElement('style')
      style.setAttribute('data-plugin', NS)
      style.setAttribute('data-plugin-css', STYLE_TAG_ID)
      style.setAttribute('data-dsh-skill-center', '')
      style.textContent = CSS
      head.appendChild(style)
      return () => {}
    }

    /**
     * Mount the client half.
     *
     * Every slot is reached through `ctx.slots.inject`, because a slot is only
     * declared once its owner's entry is on the ledger — which can happen
     * before or after this plugin, and is not guaranteed at all (the harness's
     * Settings shell is a disableable entry, and it is switched off on some
     * profiles).
     * @param ctx - the client cordis context.
     */
    function apply(ctx) {
      const store = createStore()
      ctx.effect(() => attachStyles(), `${NS}: styles`)

      const dictionaries = { zh: STRINGS.zh, en: STRINGS.en }
      ctx.effect(() => {
        const off = ctx.locale.register(NS, dictionaries)
        return typeof off === 'function' ? off : () => {}
      }, `${NS}: dictionaries`)
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const onKey = (event) => {
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'K' || event.key === 'k')) {
            event.preventDefault()
            store.set({ open: !store.get().open })
            return
          }
          // Escape unwinds one layer at a time, so it never skips past the
          // thing the user is actually looking at.
          if (event.key !== 'Escape') return
          const state = store.get()
          if (state.preview !== undefined) {
            event.preventDefault()
            store.set({ preview: undefined, previewFor: '' })
          } else if (state.detail !== undefined) {
            event.preventDefault()
            store.set({ detail: undefined, preview: undefined, previewFor: '' })
          } else if (state.open) {
            event.preventDefault()
            store.set({ open: false })
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, `${NS}: keyboard shortcuts`)

      const register = (slot, meta, component, label) => {
        ctx.slots.inject(slot, () => {
          try {
            const off = ctx.slots.register({ name: slot, ...meta }, component)
            return typeof off === 'function' ? off : () => {}
          } catch (error) {
            console.error(`[${NS}] failed to register ${label}:`, error)
            return () => {}
          }
        })
      }

      register('sidebar.footer.action', { id: NS, order: 60, label: () => t('nav'), locale: NS, inject: () => ({ store, t }) },
        (props = {}) => e(FooterAction, { store, t, wide: props.wide !== false }), 'sidebar footer action')

      register('shell.overlay', { id: NS, order: 20, label: () => t('nav'), locale: NS, inject: () => ({ store, t }) },
        () => e(Overlay, { store, t }), 'shell overlay')

      register('settings.section', { id: NS, order: 200, label: () => t('nav'), locale: NS, inject: () => ({ store, t }) },
        () => e(Panel, { store, mode: 'inline', t }), 'settings section')

      void boot(store)
      console.info(`[${NS}] client ready`)
    }

    exports.name = NS
    exports.inject = ['slots', 'locale']
    exports.apply = apply
    return module.exports
  },
})
