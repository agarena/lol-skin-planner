# 快照与 Skill 设计（只读静态数据方案）

> 历史设计稿，仅存档，未实施。当前实现以 `docs/SPEC.md` 为准。

- 状态：设计稿，未实施
- 日期：2026-11-20
- 适用范围：`core/`、`cli/`、`electron/`、`skills/`
- 结论：新增“刷新后导出快照 → 纯文件查询 CLI → Skill 只读快照”的链路，Skill 不再连接 LCU、不再提权。

---

## 1. 背景与目标

### 1.1 使用前提（用户确认）

1. 先启动英雄联盟客户端并登录到大厅；
2. 再启动本工具（管理员）；
3. 在工具里执行一次刷新；
4. 之后才使用 Skill。

因此 Skill 面对的是**一次刷新后的本地静态数据**，而不是实时 LCU。

### 1.2 目标

- 刷新时把账号资产、商城、梯度、方案等数据落成稳定的本地快照；
- Skill 只读快照，客户端关闭、无管理员权限时仍可查询；
- 查询结果带明确的数据时间与口径，不把旧数据说成实时数据；
- 快照与 Skill 的字段、错误码、降级行为有稳定契约。

### 1.3 非目标

- 不新增常驻 HTTP/MCP 服务（本期）；
- 不改变“只读 LCU、不注入、不代付”的原则；
- 不把快照上传到任何远端；
- 不让 Skill 直接拼接 LCU 请求或调用需要提权的 CLI。

---

## 2. 现状差距

| 环节 | 现状 | 差距 |
|---|---|---|
| 刷新 | `refreshAll()` 把数据放在渲染进程 state 与 `core/` 内存缓存 | 进程退出即丢失，Skill 无法读取 |
| 磁盘 | 只有 `skins.json`、`plans.json`、`%TEMP%` 下零散缓存 | 没有完整账号快照 |
| CLI | `cli/lol.js` → `core/index.js` → `core/lcu/connection` | 仍会连 LCU，可能触发提权 |
| 活动数据 | `data/act-sale.json` 手工生成，绑定活动 ID | 过期后仍会被读取 |
| 方案数据 | 桌面端写 `userData/plans.json`，CLI 默认写 `%TEMP%` | 两端不互通 |
| Skill | 硬编码项目绝对路径，调用实时 CLI | 不满足“静态数据”前提 |

---

## 3. 总体设计

```text
英雄联盟客户端（LCU，只读）
        │
        ▼
本工具主进程（管理员）
  core/ 采集：藏品 / 成就 / 对局 / 战利品 / 钱包
             商城 / 折扣 / 神话商店 / 梯度 / 方案
        │
        ├──► snapshot.json   完整快照（机器读）
        └──► summary.json    摘要（LLM 先读，小体积）

客户端关闭 / 无提权时：
  Skill ──► cli/snapshot.js（纯文件，不 import connection）
              └──► snapshot.json / summary.json
```

关键约束：

- **写快照**只发生在主进程，单写者；
- **读快照**允许任意进程并发，只读；
- `cli/snapshot.js` 的依赖白名单：`node:fs`、`node:path`、`core/analyzer`、`core/share3`；
- 禁止 `cli/snapshot.js` 引入 `core/index.js`、`core/lcu/*`、`core/connection`。

---

## 4. 文件布局与生命周期

| 文件 | 路径 | 说明 |
|---|---|---|
| 完整快照 | `%APPDATA%\lol-skin-planner\snapshot\snapshot.json` | 主产物 |
| 摘要 | `%APPDATA%\lol-skin-planner\snapshot\summary.json` | 建议 < 100KB |
| 上一版 | `%APPDATA%\lol-skin-planner\snapshot\snapshot.prev.json` | 原子替换失败时回退 |
| 刷新错误 | `%APPDATA%\lol-skin-planner\snapshot\last-error.json` | 本次刷新失败诊断，不覆盖旧快照 |
| 稳定启动器 | `%APPDATA%\lol-skin-planner\bin\lol-snapshot.cmd` | 由主进程写入，指向当前安装位置；Skill 只认这个路径 |

### 4.1 写入策略

1. 写入 `snapshot.json.tmp-<pid>`；
2. `fsync` 后关闭；
3. 若存在旧文件，先重命名为 `snapshot.prev.json`；
4. 将临时文件重命名为 `snapshot.json`；
5. 同样流程写 `summary.json`；
6. 任一步失败：保留旧快照，写 `last-error.json`。

### 4.2 保留策略

- 默认只保留 `snapshot.json` + `snapshot.prev.json`；
- 不默认保留历史版本，避免磁盘膨胀；
- 调试开关 `snapshot.historyKeep`（默认 0）可保留最近 N 份。

### 4.3 启动器

`lol-snapshot.cmd` 内容由主进程生成，例如：

```bat
@echo off
node "C:\...\app.asar.unpacked\cli\snapshot.js" %*
```

开发态指向项目目录，安装态指向 `resources` 下解包目录。Skill 固定调用该文件，避免硬编码项目路径。

---

## 5. 快照 Schema

### 5.1 顶层结构

```json
{
  "schemaVersion": 1,
  "kind": "lol-snapshot",
  "generatedAt": "2026-11-20T15:30:00.000Z",
  "generatedBy": { "app": "lol-skin-planner", "version": "0.1.0" },
  "account": {},
  "catalog": {},
  "collection": {},
  "usage": {},
  "championStats": {},
  "loot": {},
  "wallet": {},
  "store": {},
  "mythicShop": {},
  "skinPrefs": {},
  "currentSelection": {},
  "plans": [],
  "dataFreshness": {},
  "diagnostics": {}
}
```

### 5.2 分区字段

#### account

| 字段 | 类型 | 说明 |
|---|---|---|
| summonerId / puuid | string | 账号唯一标识，用于切换检测 |
| gameName / tagLine | string | 召唤师名，Skill 默认脱敏输出 |
| level | number | 等级 |
| rp / ip / mythic | number | 点券、蓝色精萃、神话精萃 |

#### catalog

静态皮肤与英雄索引，不依赖客户端即可完成名称匹配。

| 字段 | 说明 |
|---|---|
| meta.source / meta.fetchedAt / meta.filterVersion | 来源、时间、经典模式过滤版本 |
| champions[id] | `{ id, name, alias, title, roles }` |
| skins[id] | `{ id, name, championId, championName, isBase, rarity, rarityLabel, rarityRank, legacy, lines, universes, tilePath, splashPath, chromaCount, releaseLabel, releaseAt }` |

说明：`releaseLabel/releaseAt` 在导出时合并 `data/skin-release.json`，使 Skill 不再依赖该文件。

#### collection

| 字段 | 说明 |
|---|---|
| stats | `championOwned/championTotal/skinOwned/skinTotal/rawChampionCount/removedClassic/removedDuplicate` |
| champions[] | `{ id, name, alias, roles, owned, freeToPlay, ownedSkinCount, totalSkinCount, maxOwnedRarityRank, maxOwnedRarityLabel, skins[] }` |
| skins[] | `{ id, name, isBase, owned, state, rarity, rarityLabel, rarityRank, legacy, releaseAt, releaseLabel, chromas, chromaList[], prestigeChromas, stillObtainable }` |

口径：`owned` 含租借；战利品不算已拥有；`state` 为 `owned/lootPermanent/lootShard/none`。

#### usage

| 字段 | 说明 |
|---|---|
| available / masteryAvailable / matchHistoryAvailable | 可用性 |
| matchFetched / matchRequested / truncated | 对局实际条数（通常 20） |
| champions[] | `{ championId, masteryLevel, masteryPoints, highestGrade, games, wins, winRate, recent30, recent7, lastPlayed, score, rank }` |
| byChampion | 同上，按 ID 索引 |

#### championStats

`{ fetchedAt, modes, byChampion: { [championId]: { ranked: {...}, aram: {...} } } }`，字段含 `tier/rank/winRate/pickRate/banRate/kda/games/positions`。

#### loot / wallet

| 分区 | 字段 |
|---|---|
| loot | `{ available, stats, bySkinId, items[] }` |
| wallet | `{ rp, ip, mythic, orange }`，不保存 `raw` |

#### store

| 字段 | 说明 |
|---|---|
| counts | `all/inStore/notPurchasable/featured/sale/limitedTime/legacy/unowned/mythicSale` |
| items[] | `{ skinId, owned, state, inStore, purchasable, onSale, rp, originalRp, discountPct, saleEnd, limitedTime, inactiveDate, featured, legacy, releaseLabel, popularity, mythicSale }` |

口径：`purchasable` 表示点券可直购；`limitedTime` 已排除 2029/2099 占位日期；`legacy` 来自 `skins.json.isLegacy`。

#### mythicShop

| 字段 | 说明 |
|---|---|
| available / fromCache / shopDate / updatedAt / expiresAt | 状态与轮换周期 |
| sections[] | `{ title, isMythic, endsAt, upcoming, items[] }` |
| mythic | `{ total, unowned, matched }` |
| attribution | itemshop.gg 署名信息 |

#### skinPrefs / currentSelection

| 分区 | 说明 |
|---|---|
| skinPrefs | `{ available, updatedAt, total, entries[] }`，不保存客户端安装路径 |
| currentSelection | 刷新瞬间的 BP 状态；`inChampSelect=false` 时仅记录阶段 |

#### plans

`[{ id, name, createdAt, updatedAt, skinIds, budget: { rp, mythic } }]`，与桌面端 `userData/plans.json` 同源。

#### dataFreshness

```json
{
  "catalog":      { "fetchedAt": 0, "source": "lcu-game-data", "ageMs": 0, "targetTtlMs": 21600000 },
  "release":      { "fetchedAt": 0, "count": 0, "source": "merakianalytics.com" },
  "popular":      { "fetchedAt": 0, "count": 0, "source": "lolskins.io/popular" },
  "prestige":     { "fetchedAt": 0, "count": 0, "source": "splash.buguoguo.cn" },
  "actSale":      { "fetchedAt": 0, "count": 0, "endDate": null, "source": "lol.qq.com" },
  "opgg":         { "fetchedAt": 0, "modes": ["ranked", "aram"] },
  "itemshop":     { "fetchedAt": 0, "shopDate": null, "expiresAt": null }
}
```

#### diagnostics

```json
{
  "errors": [ { "section": "store", "code": "HTTP_500", "message": "..." } ],
  "warnings": [ "对局仅取到 20 场", "活动数据已过期" ],
  "timings": { "collection": 1800, "store": 420, "total": 6200 }
}
```

### 5.3 summary.json

面向 LLM 的小体积视图，字段固定：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-20T15:30:00.000Z",
  "account": { "summonerId": "", "puuid": "", "gameNameMasked": "玩***家", "level": 0, "rp": 0, "mythic": 0 },
  "collection": { "championOwned": 0, "championTotal": 0, "skinOwned": 0, "skinTotal": 0, "zeroSkinCount": 0 },
  "zeroSkinChampions": [ { "id": 0, "name": "", "totalSkinCount": 0 } ],
  "topChampions": [ { "rank": 1, "championId": 0, "name": "", "masteryLevel": 0, "masteryPoints": 0, "recent30": 0, "score": 0 } ],
  "store": { "counts": {}, "saleTop": [ { "skinId": 0, "name": "", "rp": 0, "discountPct": 0, "saleEnd": null } ] },
  "mythic": { "shopDate": null, "expiresAt": null, "total": 0, "unowned": 0, "featured": [] },
  "plans": [ { "id": "", "name": "", "skinCount": 0, "budget": { "rp": 0, "mythic": 0 } } ],
  "dataFreshness": {},
  "warnings": []
}
```

### 5.4 版本兼容

- `schemaVersion` 递增表示破坏性变更；Skill 遇到更高主版本时只读已知字段并提示升级。
- 快照带 `catalog.meta.filterVersion` 与 `collection.stats.catalogSkins`；分享码导入仍需校验皮肤总数，避免索引错位。
- 新增字段只增不改；删除字段必须升 `schemaVersion`。

---

## 6. 采集与刷新流程

### 6.1 触发

- 主界面「刷新」成功后自动导出；
- 设置页提供「导出快照」按钮，允许刷新后单独重写；
- 不做定时刷新（符合“用前刷新一次”的前提）。

### 6.2 采集顺序

| 步骤 | 数据 | 现有实现 | 失败影响 |
|---|---|---|---|
| 1 | 连接与账号 | `connection.discover` | 致命，保留旧快照 |
| 2 | 藏品 + 战利品 + 钱包 | `collection.getCollection({force})` | 致命，保留旧快照 |
| 3 | 成就 + 对局 | `usage.buildUsage` | 降级，`usage.available=false` |
| 4 | 梯度 | `championstats.getAll` | 降级 |
| 5 | 商城条目 | `storeitems.getStoreItems({force})` | 降级，`store.available=false` |
| 6 | 价格与折扣 | `store.fetchPrices` / `fetchSales` | 降级 |
| 7 | 神话商店 | `mythicshop.getMythicShop({force})` | 降级 |
| 8 | 皮肤偏好 | `skinprefs.readSkinPreferences` | 降级 |
| 9 | BP 状态 | `getCurrentSelection` | 降级 |
| 10 | 方案 | `plans.listPlans` | 降级 |
| 11 | 静态数据元信息 | `release/popular/prestige/mythicsale` 的 `meta()` | 记录警告 |

### 6.3 关键规则

- 只有第 1、2 步成功才允许覆盖快照；否则写 `last-error.json` 并保留旧文件。
- 降级分区写 `available: false` 与 `errors[]`，不得用空数组冒充“没有数据”。
- 活动数据若 `endDate < now`，在 `warnings` 中标注“活动已结束”，`store` 中不再把活动折扣当作当前折扣。
- 刷新总耗时预算 10 秒内；超过 15 秒在 UI 提示可关闭价格/神话模块。

### 6.4 测试钩子

- `?mock=1` 下允许导出 mock 快照，便于 Skill 联调；
- 环境变量 `SNAPSHOT_DIR` 可覆盖输出目录，便于自动化测试。

---

## 7. 新鲜度与失效

| 分区 | 目标 TTL | 过期行为 |
|---|---|---|
| account / collection | 5 分钟 | 超过 24h 在 `warnings` 标记“快照较旧” |
| usage / mastery / match | 90 秒 | 同上 |
| loot | 60 秒 | 同上 |
| store / prices | 5 分钟 | 超过 24h 标记“价格可能已变” |
| mythicShop | 30 分钟 | 超过 12h 标记“轮换可能已更新” |
| opgg | 1 小时 | 超过 24h 标记“梯度过期” |
| catalog | 6 小时 | 超过 7d 标记“元数据过旧” |
| actSale | 活动截止日 | 截止后标记“活动已结束” |
| release / popular / prestige | 12 小时 ~ 手工 | 只展示 `fetchedAt`，不阻断 |

Skill 输出规则：

- 任何回答都带“数据时间：YYYY-MM-DD HH:mm”；
- `warnings` 非空时，先说明限制，再给结论；
- 用户问“现在多少钱/现在在售吗”时，若快照超过 24h，明确说明“这是快照价格，可能已变化”，并给出刷新步骤。

---

## 8. 账号与隐私

- 快照写入 `summonerId` 与 `puuid`；Skill 检测到用户在对话里提到的账号与快照不一致时提示“当前快照属于另一个账号”。
- `summary.account.gameNameMasked` 默认脱敏；完整名称只在 `snapshot.account`，Skill 默认不回显。
- 快照不包含：LCU token、端口、安装路径、`wallet.raw`、客户端配置文件路径。
- 快照为本地明文 JSON；文档明确“不要分享 `snapshot.json`”，分享请用方案分享码。

---

## 9. 查询 CLI 契约（cli/snapshot.js）

### 9.1 命令

| 命令 | 作用 | 主要参数 |
|---|---|---|
| `meta` | 快照元信息、账号、新鲜度、warnings | `--json` |
| `summary` | 输出 `summary.json` | `--json` |
| `collection` | 藏品概览或英雄列表 | `--json --only-owned --limit N` |
| `champion <id\|名称>` | 单英雄全部皮肤与拥有状态 | `--json` |
| `skin <id\|名称>` | 单皮肤详情（含价格快照） | `--json` |
| `search <关键词>` | 按皮肤名/英雄名检索 | `--json --limit N` |
| `top` | 常用英雄榜 | `--limit N --json` |
| `analyze` | 清单分析（S/A/B/C/D） | `--text --file --json --no-prices` |
| `store` | 商城视图 | `--view all\|sale\|featured\|limitedTime\|mythicSale\|newest --only-unowned --limit N --json` |
| `mythic` | 神话商店轮换 | `--json` |
| `plans` | 方案列表 | `--json` |
| `prefs` | 皮肤偏好 | `--json` |
| `current` | 刷新瞬间的 BP 状态 | `--json` |

### 9.2 输出与错误码

- 默认人类可读；`--json` 输出稳定结构。
- 退出码：`0` 成功；`2` 参数错误；`3` 快照不存在；`4` 快照损坏/版本不支持；`5` 目标分区不可用。

错误对象：

```json
{ "ok": false, "code": "SNAPSHOT_MISSING", "message": "还没有快照，请先启动客户端和本工具并刷新一次" }
```

### 9.3 模块边界

- 允许：`node:fs`、`node:path`、`core/analyzer`、`core/share3`；
- 禁止：`core/index.js`、`core/lcu/*`、`electron/*`；
- `analyzer` 目前内部依赖 `core/release` 读 `data/skin-release.json`，实施时需改为“优先使用快照里的 `releaseAt/releaseLabel`，缺失再回退文件”，避免 Skill 依赖安装目录。

---

## 10. Skill 规格

### 10.1 建议名称

`lol-account-query`（只读账号与商城快照查询）

与现有 `lol-skin-advisor`（购买决策）分工：

- `lol-account-query`：查资产、查皮肤、查常玩、查商城、查方案；
- `lol-skin-advisor`：拿到清单后做 S/A/B/C/D 决策与话术。

两者共用同一份数据字典与同一个 `lol-snapshot.cmd`。

### 10.2 触发条件

用户说“我有哪些皮肤/英雄”“这个皮肤我有没有”“最近常玩什么”“商城哪些打折”“神话商店这周是什么”“帮我看看这个方案”“我零皮肤的英雄有哪些”等。

### 10.3 前置检查

1. 读取 `summary.json`；不存在则读取 `snapshot.json` 的 meta；
2. 两者都不存在 → 回答固定引导：
   “还没有本地快照。请先启动英雄联盟客户端 → 启动本工具 → 点一次刷新，然后再问我。”
3. 快照存在但 `generatedAt` 超过 24h → 先提示数据时间；
4. `warnings` 非空 → 在回答中列出关键限制。

### 10.4 工具调用

只调用 `%APPDATA%\lol-skin-planner\bin\lol-snapshot.cmd`，不直接读 LCU，不调用 `cli/lol.js`。

### 10.5 回答规范

- 先给结论，再给依据；
- 每个数字附口径（例如“已拥有 495 款，不含基础皮肤与经典模式变体”）；
- 区分“已拥有 / 战利品永久 / 战利品碎片 / 未拥有”；
- 价格必须标注“快照时间”；
- 不编造缺失分区，明确说“本次快照没有拿到商城数据”；
- 不输出完整 1900+ 皮肤清单，按需分页或只给 Top N。

### 10.6 失败降级

| 情况 | 行为 |
|---|---|
| 无快照 | 引导刷新，不猜测 |
| 快照损坏 | 尝试 `snapshot.prev.json`；仍失败则引导重新刷新 |
| 分区 `available=false` | 如实说明该分区缺失，其余照常回答 |
| 账号不一致 | 提示快照属于哪个账号（脱敏），询问是否切换后刷新 |
| 用户要实时价格 | 说明快照限制，给出刷新步骤，不承诺实时 |

---

## 11. 现有 Skill 改造

- `skills/lol-skin-advisor/SKILL.md`：
  - 删除硬编码项目路径；
  - 数据获取从 `cli/lol.js` 改为 `lol-snapshot.cmd`；
  - 增加“先读 summary / 数据时间 / warnings”的前置段；
  - 保留 S/A/B/C/D 话术与“不代付”边界。
- 安装位置：
  - 当前只装到 `~/.dsh/skills`，且版本旧于项目内文件；
  - 实施时提供 `tools/install_skill.js`，同步安装到目标 Agent 的技能目录，并校验哈希一致。
- 新增共享文档 `skills/references/data-dictionary.md`，避免两个 Skill 各写一套口径。

---

## 12. 性能与体积预算

| 项 | 预算 | 说明 |
|---|---|---|
| 刷新总耗时 | ≤ 10s | 藏品约 1.8s，价格目录约 3.5s，梯度 1~2s |
| `snapshot.json` | ≤ 6MB | 藏品原始接口约 8MB，导出时裁剪 `rawName/raw` 等 |
| `summary.json` | ≤ 100KB | 供 LLM 直接读取 |
| Skill 单次查询 | ≤ 1s | 纯文件读取 + 内存过滤 |
| 写入放大 | 每次刷新 2 个文件 | 不做历史归档默认 |

---

## 13. 验收标准

1. 客户端关闭、无管理员权限时，`lol-snapshot.cmd summary` 仍可返回结果。
2. `snapshot.json` 不包含 token、端口、客户端安装路径、`wallet.raw`。
3. 刷新中途杀进程，旧 `snapshot.json` 仍完整可读。
4. 同一份快照下，`snapshot analyze` 与在线 `cli/lol.js analyze` 的分层结果一致（允许价格缺失导致的差异，需在 warnings 说明）。
5. 快照账号与用户描述不一致时，Skill 能提示。
6. 活动过期后，`store` 不再把活动折扣当作当前折扣，且 `warnings` 有说明。
7. `lol-snapshot.cmd` 在开发态与安装态都指向正确位置，移动项目目录后只需重新导出启动器。
8. Skill 在无快照时给出明确的三步引导，不输出猜测数据。

---

## 14. 实施拆分（后续）

| 阶段 | 内容 | 产物 |
|---|---|---|
| P0 | `core/snapshot.js`：采集编排、裁剪、原子写、summary 生成 | 快照文件 |
| P0 | 主进程 IPC：`snapshot:export`，刷新成功后自动调用；设置页按钮 | UI 入口 |
| P1 | `cli/snapshot.js`：只读查询与 analyze | 查询 CLI |
| P1 | 主进程写 `bin/lol-snapshot.cmd` | 稳定启动器 |
| P2 | 新建 `lol-account-query` Skill；改造 `lol-skin-advisor` | Skill |
| P2 | `tools/install_skill.js`、数据字典 | 安装与文档 |
| P3 | 打包配置补 `core/`、`data/`、`cli/`；可写目录迁到 `userData` | 可分发安装包 |
| P3 | 回归：快照离线查询、原子写、账号切换、活动过期 | 验收记录 |

---

## 15. 风险与开放问题

| 风险 | 影响 | 应对 |
|---|---|---|
| 商城/神话商店刷新失败 | Skill 无法回答价格 | 分区降级 + warnings，不阻断资产查询 |
| 快照价格快速过期 | 用户误以为实时 | 强制展示数据时间；>24h 提示刷新 |
| 快照体积偏大 | LLM 上下文压力 | 只读 summary；查询走 CLI 过滤 |
| 打包后 `data/` 只读 | 上线时间/臻彩无法回写 | 快照导出时合并；可写数据迁到 `userData` |
| 方案路径不一致 | Skill 看不到界面方案 | 统一 `plansConfigure` 到 `userData` |
| 分享码依赖皮肤总数 | 版本错位无法导入 | 快照记录 `catalogSkins`，导入前校验 |
| Skill 安装目录差异 | Trae/其他 Agent 找不到 | 安装脚本同步多目录并校验哈希 |
| 多账号切换 | 快照与用户描述不符 | 账号标识 + 提示重新刷新 |

开放问题：

1. `summary.json` 是否需要包含“全部零皮肤英雄”（约 100+ 条），还是只放 Top 20 + 总数？
2. 商城快照是否保留全部 1967 条 `items`，还是只保留在售/折扣/限定子集，其余按需从 `catalog` 还原？
3. 是否需要在 UI 上固定展示“快照时间 / 账号 / warnings”，作为 Skill 回答的可信度提示？
