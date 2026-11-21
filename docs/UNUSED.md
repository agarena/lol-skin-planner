# 未使用接口与数据清单

> 盘点日期：2026-11-20　｜　对应版本：0.1.0
>
> 目的：把**已经写了但没有任何入口、没有调用方、或采集了却没展示**的接口、数据、文件和文案集中列出，作为清理与发布前的依据。
>
> 判定方式：全仓库检索调用方（`src/`、`electron/`、`cli/`、`core/`、`tools/`），并区分「完全未使用」「仅 CLI/Skill 使用」「仅调试可达」三种情况，避免误删。

---

## 0. 结论

- 没有发现「未使用但会导致运行故障」的代码；下面全部是**清理候选**，不是紧急 bug。
- 真正影响「对外分发」的不是这些未使用代码，而是**下载链接、打包验证、图标、签名、数据再分发许可、过期文档**，见第 6 节。
- 建议按「先删确定死的 → 再决定保留字段 → 最后处理发布项」的顺序做，避免一次改太多。

### 本轮已完成（2026-11-20）

| 处理 | 内容 |
|---|---|
| 已删除 | `TopBar.jsx`、对局历史模块与导出、`stats:compare` / `compareChampions`、`analyze:dry` / `analyzeDry`、`getSales`、`getLoot`、`sharePlan`/`importPlan` 直接导出、`mythicSaleIds`、`filters.recent30` |
| 已修正 | 底栏版本改为读 `app:info`；README 增加非官方声明；`CHANGES.md` / 快照设计稿加历史说明；`SKILL.md` 去掉「对局」和失效的 `启动(管理员).cmd` |
| 仍待处理 | 下载/外链地址（需要你提供）、应用图标（需要视觉）、管理员打包、数据再分发许可、保留字段的产品决定 |

---

## 1. 完全未使用的代码与接口

> 下表第 1–9 项与第 11 项已于 2026-11-20 删除；保留记录用于说明判定依据。第 10 项（URL 调试视图）仍保留。

| # | 对象 | 位置 | 证据 | 建议 |
|---|---|---|---|---|
| 1 | `TopBar` 组件 | `src/components/TopBar.jsx` | 没有任何 `import TopBar`；顶栏实际写在 `src/App.jsx` 的 `<header className="topbar">` | 删除组件 |
| 2 | 对局历史模块 | `core/lcu/matchhistory.js` | 只被 `core/index.js` require 并原样导出，没有任何调用方；常玩英雄已改用成就 | 删除模块与导出；若想保留「近期常用」，标注为 experimental |
| 3 | `matchHistory` 导出 | `core/index.js` | 同上，仅 re-export | 删除 |
| 4 | `stats:compare` 链路 | `electron/main.js`、`electron/preload.js`、`core/index.js`、`core/championstats.js` | 主进程注册了 `stats:compare`，preload 暴露 `compareChampions`，但 `src/` 无任何调用 | 删除 4 处；或保留给未来「英雄对比」功能并补入口 |
| 5 | `analyze:dry` 链路 | `electron/main.js`、`electron/preload.js` | 注册并暴露了 `analyzeDry`，`src/` 无调用；只有 `src/mock.js` 里有一个假实现 | 删除；如测试需要，移到测试脚本 |
| 6 | `core.getSales()` | `core/index.js` | 无任何调用；实际取折扣走 `store.fetchSales` / `store:prices` | 删除包装函数 |
| 7 | `core.getLoot()` | `core/index.js` | 无任何调用；藏品采集内部直接用 `loot` 模块 | 删除包装函数 |
| 8 | `core.sharePlan` / `core.importPlan` 直接导出 | `core/index.js` | 主进程实际调用 `core.plans.sharePlan` / `core.plans.importPlan`，没有调用直接导出 | 删除这两个直接导出 |
| 9 | `mythicSaleIds()` | `core/mythicsale.js` | 无调用方 | 删除 |
| 10 | `view=inStore` / `notPurchasable` / `mythicSale` 分支 | `src/pages/StorePage.jsx`、`core/lcu/storeitems.js` | 没有对应 UI 选项；只可能通过 `?view=` 调试参数或 `INIT_VIEW` 触发 | 若保留调试，加注释；否则删除分支 |
| 11 | `filters.recent30` | `src/pages/StorePage.jsx` | `EMPTY_FILTERS` 里有，`applyFilters` 里有，但 `FilterPanel` 没有控件；且 `usage.recent30` 恒为 0 | 删除（双重死逻辑） |

### 1.1 相关 LCU 端点

| 端点 | 使用位置 | 状态 |
|---|---|---|
| `GET /lol-summoner/v1/current-summoner` | 藏品采集、连接校验 | 使用中 |
| `GET /lol-champions/v1/inventories/{summonerId}/champions` | 藏品采集 | 使用中 |
| `GET /lol-inventory/v1/wallet/IP` | 钱包 | 使用中 |
| `GET /lol-loot/v1/player-loot` | 战利品状态 | 使用中 |
| `GET /lol-game-data/assets/v1/skins.json` | 静态皮肤库 | 使用中 |
| `GET /lol-game-data/assets/v1/champion-summary.json` | 英雄摘要 | 使用中 |
| `GET /lol-game-data/assets/v1/skinlines.json` | 皮肤系列 | 使用中 |
| `GET /lol-game-data/assets/v1/universes.json` | 宇宙分组 | 使用中 |
| `GET /lol-champion-mastery/v1/local-player/champion-mastery` | 成就/常玩 | 使用中 |
| `GET /lol-store/v1/skins` | 商城列表 | 使用中 |
| `GET /lol-store/v1/featured` | 精品推荐 | 使用中 |
| `GET /lol-store/v1/catalog` | 价格/探测 | 使用中 |
| `GET /lol-store/v1/catalog/sales` | 限时折扣 | 使用中 |
| `GET /lol-store/v1/skins/{skinId}` | 单品（CLI `skin`、价格兜底） | 使用中 |
| `GET /lol-store/v1/getStoreUrl` | 设置里的商城能力探测 | 仅探测 |
| `GET /lol-gameflow/v1/gameflow-phase` | CLI `current` 判断阶段 | 仅 CLI |
| `GET /lol-champ-select/v1/session` | CLI `current` 读当前选人 | 仅 CLI |
| `GET /lol-match-history/v1/products/lol/{puuid}/matches` | 已废弃的对局模块 | **未使用** |
| 本地 `Config/LCUAccountPreferences.yaml` | CLI `prefs` 读每个英雄上次选的皮肤 | 仅 CLI |

### 1.2 外部数据源

| 来源 | 运行时是否使用 | 说明 |
|---|---|---|
| `itemshop.gg/api/v1/shop/league-of-legends` | 是 | 神话商店；必须保留来源链接 |
| `lol-api-champion.op.gg` | 是 | 英雄梯度；global 口径 |
| `www.bilibili.com` / `api.bilibili.com` | 是 | 启动时补全缺失上线时间，每次最多 20 条 |
| `splash.buguoguo.cn/prestigechromas` | 是 | 臻彩清单，12 小时检查 |
| `lol.qq.com/act/...` | 否（仅工具） | `tools/parse_act.js` 生成 `data/act-sale.json` |
| `lolskins.io/popular` | 否（仅工具） | `tools/fetch_popular.js` 生成 `data/popular-skins.json` |
| Meraki Analytics | 否（仅工具） | `tools/fetch_release.js` 生成 `data/skin-release.json` |

---

## 2. 采集了但界面没有使用的数据

这些字段不是「接口没用」，而是**数据拿到了、也存进了对象，但没有一个界面读取**。删除前要确认 CLI / 未来功能是否还需要。

| # | 字段 | 位置 | 现状 | 建议 |
|---|---|---|---|---|
| 1 | `freeToPlay` | `core/lcu/collection.js` | 英雄是否周免；前端只读 `owned` | 删除，或用于「未拥有但周免」提示 |
| 2 | `stillObtainable` | `core/lcu/collection.js` | 皮肤是否仍可获得；前端未读 | 删除，或用于「已绝版」标签 |
| 3 | `gemPath` | `core/lcu/collection.js` | 稀有度宝石图路径；前端未读（用 `GEM` 映射） | 删除 |
| 4 | `prestigeChromas` | `core/lcu/collection.js` | 臻彩数量；前端改读 `chromaList` 计算 | 删除 |
| 5 | `rawName` | `core/lcu/collection.js` | 客户端原始名；前端未读 | 删除 |
| 6 | `chromaCount` | `core/lcu/catalog.js` | 炫彩数量；前端未读 | 删除 |
| 7 | `tokens` / `milestone` | `core/lcu/mastery.js` | 成就代币/里程碑；`usage` 没有复制，前端也没有 | 删除 |
| 8 | `highestGrade` / `lastPlayTime` | `core/lcu/mastery.js`、`core/usage.js` | 复制到了 usage，但界面与 CLI 都不展示 | 保留可作未来「最近战绩」；否则删除 |
| 9 | `budget` | `core/plans.js` | 方案里存 `rp/mythic` 预算，CLI `plans` 会显示，但**没有任何写入入口**，实际恒为 0 | 加预算编辑，或删除字段与 CLI 展示 |
| 10 | `games` / `wins` / `winRate` / `recent30` / `recent7` / `lastPlayed` | `core/usage.js` | 对局采集移除后恒为 0；`analyzer` 仍在输出/拼理由 | 删除，或统一标注 `deprecated` 并从分析理由里去掉 |
| 11 | `matchHistoryAvailable` / `matchFetched` / `matchRequested` / `truncated` | `core/usage.js`、`src/mock.js` | 与对局能力一起残留，前端未读 | 已删除 |

> 这些字段大多是为了「以后可能用」保留的。对外发布前建议做一次决定：**要么有入口，要么删掉**，不要让数据层继续背着一堆永远为 0 的字段。

---

## 3. 只给 CLI / Skill / 调试用的能力

这些不是死代码，桌面端没入口，但 `cli/lol.js` 或 Skill 会用到，**不要按「前端没调用」直接删**。

| 能力 | 入口 | 使用者 |
|---|---|---|
| `getSkinPreferences()` | `node cli/lol.js prefs` | 读每个英雄上次选的皮肤 |
| `getCurrentSelection()` | `node cli/lol.js current` | 选人阶段读当前英雄/皮肤 |
| `getChampion()` | `node cli/lol.js champion <id>` | 单英雄全部皮肤 |
| `getSkin()` | `node cli/lol.js skin <id>` | 单品详情 + 价格 |
| `getTopChampions()` | `node cli/lol.js top` | 常用英雄榜 |
| `getPrices()` | CLI 方案详情 | 方案皮肤价格 |
| `plans` / `plan` | `node cli/lol.js plans` / `plan` | 方案列表/创建 |
| `analyze()` | `node cli/lol.js analyze` | Skill 核心清单分析 |
| `collection --full` | CLI | 带每款皮肤的完整藏品 |
| `?view=` / `INIT_VIEW` / `INIT_POP` / `INIT_GROUP` / `?demo=1` | 浏览器/启动参数 | 截图、调试、验收 |

另外：

- `src/mock.js` 只服务 `?mock=1`，**不会进打包产物的运行路径**（会被 Vite 打进 JS，但只在 mock 标志下启用）。
- `tools/` 下的 `probe_lcu.py`、`get_conn_elevated.ps1`、`fetch_*.js`、`parse_act.js` 都是开发/数据生成工具，不参与桌面端运行。

---

## 4. 无 UI 入口或恒为空的逻辑

| # | 逻辑 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | 近期常用筛选 | `StorePage` `filters.recent30` | 没有控件；即使打开，`recent30` 也恒为 0 | 删除 |
| 2 | 商城视图的 `view=inStore` / `notPurchasable` | `StorePage` + `storeitems` | 没有 UI 选项；购买方式已由「获取方式」筛选承担 | 删除，或明确只给 URL 调试 |
| 3 | 商城视图的 `view=mythicSale` | `StorePage` + `storeitems` | 没有 UI 选项；活动折扣已由「活动·折扣」筛选承担 | 删除 |
| 4 | 对局相关分析理由 | `core/analyzer.js` | 仍可能拼「近 30 天 N 场」，但 N 恒 0，不会触发 | 清理理由分支 |
| 5 | 方案预算 | `core/plans.js` | 字段存在、CLI 会显示，但无写入 | 加编辑或删除 |

---

## 5. 文件、静态资源与文档

| # | 对象 | 现状 | 建议 |
|---|---|---|---|
| 1 | `data/mythic-sale.json` | `core/mythicsale.js` 写了兜底读取，但文件不存在；当前靠 `data/act-sale.json` | 补文件，或删除兜底分支 |
| 2 | `docs/shot-analyze.png` | README 未引用；旧版分析页截图 | 删除或归档 |
| 3 | `docs/shot-deduped.png` | 未引用 | 删除或归档 |
| 4 | `docs/shot-elevate.png` | 未引用 | 删除或归档 |
| 5 | `docs/shot-mastery.png` | 未引用 | 删除或归档 |
| 6 | `docs/shot-plan.png` / `docs/shot-real-data.png` | README 引用 | 保留；发布前重新截当前版本 |
| 7 | `CHANGES.md` | 2026-11-20 的历史进度记录，功能早已完成 | 已在文件头标注「不是 changelog」；后续可移入 `docs/archive/` |
| 8 | `docs/snapshot-and-skill-design.md` | 文件头写明「设计稿，未实施」 | 已补「仅存档」说明；后续可移入 `docs/archive/` |
| 9 | `skills/lol-skin-advisor/SKILL.md` | 原描述写「对局」；启动说明写 `启动(管理员).cmd`（不存在） | 已同步为「成就」与 `启动.vbs` / `.lnk` |
| 10 | `.tmp/` | 截图、Chrome profile、验证脚本 | 已被 `.gitignore` 忽略；发布前清理工作区 |
| 11 | `.screenshots/` | 只有 `.tmp` 子目录 | 可删除 |
| 12 | `src/mock.js` | 数据量 168/2008，和真实 173/1967 不同 | 保留 mock；误导字段已删；文档继续标注「mock 不代表真实口径」 |

---

## 6. 发布前必须处理（不是「未使用」，但属于未完成）

| 优先级 | 事项 | 位置 / 证据 | 说明 |
|---|---|---|---|
| P0 | 下载链接仍是占位 | `README.md` 的 `链接待填` | 对外发布必须有真实 zip / Release 地址 |
| P0 | 底部三个外链都是占位 | `src/App.jsx` 的 `SHARE` | B 站 / GitHub / 下载都指向首页或空地址 |
| P0 | 打包未通过 | 2026-11-20 实跑 `npm run pack`：Vite 构建通过，曾生成 `release/win-unpacked`，但在解压 `winCodeSign` 时失败——当前 shell 没有创建符号链接的权限；半成品已清理 | 用**管理员权限**跑 `npm run pack`，或给打包机开启符号链接权限；成功后验证 zip、管理员 manifest、`userdata`、图片代理、离线启动 |
| P0 | 没有应用图标 | `package.json` 的 `build.win` 没有 `icon`；打包日志明确提示 `default Electron icon is used` | 补 `build/icon.ico`（256×256），再打包 |
| P0 | 没有代码签名 | `package.json` 无签名配置 | 公开下载会触发 SmartScreen；至少提供 SHA256 + VirusTotal，理想是签名 |
| P0 | 数据再分发许可未确认 | `data/*.json`、`core/prestige.js`、`core/release.js`、`core/popular.js` | Meraki / lolskins / 腾讯活动页 / 布谷鸟（GPLv3）数据的再分发条款需要确认；README 已有部分署名，但不足以覆盖所有源 |
| P0 | 缺少「非官方」声明 | `README.md` | 已补：与 Riot/腾讯无关、只读、使用风险自负 |
| P1 | 版本号写死在底栏 | `src/App.jsx` | 已改为读 `app:info` 的 `version` |
| P1 | 没有真正的 changelog | `CHANGES.md` 是历史进度记录 | 另建 `CHANGELOG.md`，发布页写清「这版改了什么」 |
| P1 | 手动测试未在打包版跑完 | `docs/TEST.md` | 至少跑「发布前冒烟」14 条 + M 类全量 |
| P1 | 方案文件非原子写 | `core/plans.js` | 公开版建议临时文件 + rename，避免断电损坏 |
| P1 | 连接 token 明文落盘 | `core/lcu/connection.js` 的 `%TEMP%/lol-lcu-conn-cache.json` | 至少限制权限/退出清理；文档里说明 |
| P1 | `package.json` 缺仓库信息 | `package.json` | 补 `repository` / `homepage` / `bugs`，方便反馈 |
| P2 | 无自动更新 | — | 先做「手动下载新 zip + 保留 userdata」的说明即可 |
| P2 | 无 CI | — | 至少加 `npm run build` + `npm run audit` 的自动检查 |

---

## 7. 建议清理顺序

**第一批：确定死代码（低风险，可直接做）**

1. 删除 `src/components/TopBar.jsx`
2. 删除 `core/lcu/matchhistory.js` 与 `core/index.js` 的 `matchHistory` 导出
3. 删除 `stats:compare` / `compareChampions` 链路（main、preload、core、championstats）
4. 删除 `analyze:dry` / `analyzeDry` 链路
5. 删除 `core.getSales`、`core.getLoot`、`core.sharePlan`/`core.importPlan` 直接导出、`mythicSaleIds`
6. 删除 `filters.recent30` 与 `StorePage` 的 `inStore` / `notPurchasable` / `mythicSale` 分支
7. 删除 `usage` 里恒为 0 的对局字段与 `matchHistoryAvailable`

**第二批：需要产品决定（删或补入口）**

1. `budget`：加预算编辑，还是删除
2. `freeToPlay` / `stillObtainable`：是否要做周免/绝版提示
3. `highestGrade` / `lastPlayTime`：是否要做「最近使用」排序
4. 商城调试视图：保留 URL 调试，还是彻底删

**第三批：文件与文档**

1. 处理 `data/mythic-sale.json` 兜底
2. 归档 `CHANGES.md`、`docs/snapshot-and-skill-design.md`
3. 同步 `skills/lol-skin-advisor/SKILL.md` 的「对局」「启动(管理员).cmd」
4. 删除未引用截图；重截 README 两张图

**第四批：发布**

按第 6 节 P0 → P1 顺序处理。

---

## 8. 删除风险提示

- `core/index.js` 是对外数据层入口，CLI、Skill、可能还有你自己的脚本依赖它。删除导出前先全仓库检索，并保留 CLI 需要的部分。
- `view=inStore` / `notPurchasable` / `mythicSale` 虽然 UI 没有入口，但可以通过 `?view=` 调试；如果截图脚本或验收脚本用过，先确认再删。
- `budget` 虽然当前没有写入入口，但方案 JSON 里可能已有历史数据；删除字段前考虑兼容旧文件。
- `mock.js` 里的假实现不要和真实能力一起删；mock 仍要覆盖主要界面，否则 `?mock=1` 会退化。
