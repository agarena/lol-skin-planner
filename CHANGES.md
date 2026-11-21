# 改动方案（本轮）

> 历史进度记录，不是 changelog。本轮改动已完成并验证；发布变更请另建 `CHANGELOG.md`。

## 当前进度（2026-11-20 18:15）

### 已完成并且验证过的

| 模块 | 状态 |
|---|---|
| LCU 只读数据（藏品 / 商城 / 价格 / 上线时间 / 臻彩 / 梯度） | ✅ |
| 总览页（圆环 / 稀有度徽章 / 三组英雄 / 常玩英雄小卡 / 眼睛图标） | ✅ |
| 决策流程（皮肤名 / 分享码 → 确认弹窗 → 对比表格 → 8 项推荐值） | ✅ |
| 方案系统（自动存 / 命名 / 到期时间 / 分享口令 / 导入 / 删除确认） | ✅ |
| 皮肤页（筛选 / 排序 / 方案筛选 / 推荐值 / 特效演示链接） | ✅ |
| 组件统一（SkinCard 竖版 / SkinMiniCard 横版） | ✅ |
| 配色（Linear 色板） | ✅ |
| 对局数据已彻底移除（改用成就等级） | ✅ |
| 绿色版打包配置（zip + userdata 跟随解压目录） | ✅ 已出 0.1.0 便携包 |
| ErrorBoundary + 自检脚本 | ✅ |

### 待执行（就是下面 5 条需求）

见「需求 1」到「需求 5」。

---
## 需求 1：快速视图加两个勾选项

### 位置
`src/components/FilterPanel.jsx` → 「快速视图」分组，现有效果：

```
快速视图
  ○ 全部皮肤
  ○ 限时打折
  ○ 限时销售
  □ 只看未拥有
```

改为：

```
快速视图
  ○ 全部皮肤
  ○ 限时打折
  ○ 限时销售
  □ 只看未拥有
  □ 零皮肤英雄            ← 新增
  □ 无史诗及以上皮肤英雄    ← 新增
```

### 语义区别（重要）

| 现有 | 新增 |
|---|---|
| 「全部皮肤 / 限时打折 / 限时销售」是**单选互斥**（radio），与「方案」互斥 | 新增两项是**复选框**（checkbox），可与任何视图叠加 |

也就是说：
- 勾「零皮肤英雄」+ 选「限时打折」→ 限时打折的皮肤里，属于零皮肤英雄的那些
- 勾「零皮肤英雄」+ 选某个方案 → 方案里属于零皮肤英雄的那些

### 实现要点

`FilterPanel` 新增两个 prop：
- `onlyZeroSkin` / `setOnlyZeroSkin`
- `onlyNoEpic` / `setOnlyNoEpic`

过滤逻辑加在 `src/pages/StorePage.jsx` 的 `list` useMemo 里：

```js
// 零皮肤英雄：该英雄一件皮肤都没有
if (onlyZeroSkin) {
  const ci = champInfoMap[x.championId]
  if (!ci || ci.skinOwned > 0) return false
}

// 无史诗及以上：该英雄已拥有的最高稀有度 < 史诗（kEpic rank 3）
if (onlyNoEpic) {
  const ci = champInfoMap[x.championId]
  if (!ci || (ci.maxOwnedRank || 0) >= 3) return false
}
```

阈值参考（`core/lcu/catalog.js` 第 13 行的 `RARITY` 常量）：

```
kNoRarity    rank 1   普通
kRare        rank 2   稀有
kEpic        rank 3   史诗   ← 「无史诗及以上」的分界线
kLegendary   rank 4   传说
kMythic      rank 5   神话
kUltimate    rank 6   终极
kExalted     rank 7   卓越
kTranscendent rank 8  圣堂
```

### 计数显示

两个选项右侧显示数量（和现有 `fg-opt` 计数一致）：
- 零皮肤英雄：`champs.filter(c => c.ownedSkinCount === 0).length`
- 无史诗及以上：`champs.filter(c => (c.maxOwnedRarityRank || 0) < 3).length`

### 涉及文件
- `src/components/FilterPanel.jsx`（UI + 参数）
- `src/pages/StorePage.jsx`（过滤逻辑 + state + 传参）

---

## 需求 2：常玩英雄逻辑确认（无需改动）

**现状确认**：`src/pages/OverviewPage.jsx:166-178`

```js
const favs = useMemo(() => {
  return champs
    .map((c) => ({ ...c, u: usageMap[c.id] }))
    .filter((c) => c.owned && c.u)
    .sort((a, b) => (b.u.score || 0) - (a.u.score || 0))
    .slice(0, 6)
    ...
```

而 `usage.score`（`core/usage.js`，对局数据已删）：

```js
row.score = row.masteryLevel * 1000 + row.masteryPoints / 100
```

**结论：已经是纯按英雄成就等级排序，不依赖对局数据。** 无需改动。

顺带要改的一处文案：

`OverviewPage.jsx:478`
```jsx
{!favs.length ? <div className="dim small">还没有对局数据</div> : null}
```
改成：
```jsx
{!favs.length ? <div className="dim small">还没有英雄成就数据</div> : null}
```

---

## 需求 3：已拥有丝带复用到皮肤卡片

### 现状

**皮肤小卡**（`src/components/SkinMiniCard.jsx`）有右上角斜丝带：

```jsx
<span className="mini-skin-ribbon">{s.owned ? '已拥有' : '未拥有'}</span>
```

CSS 定义在 `src/styles.css` 的 `.mini-skin-ribbon`（旋转 45° 的斜条）。

**皮肤卡片**（`src/components/SkinCard.jsx`）没有丝带，右上角只有折扣角标 `.skin-card-flag`。

### 改成

```
┌────────────────────────┐
│ [16:9 原画]     已拥有↗ │  ← 已拥有：只显示绿丝带
│                        │
└────────────────────────┘

┌────────────────────────┐
│ [16:9 原画]  -50% 11-23 │  ← 未拥有：显示折扣/限时角标
│                        │
└────────────────────────┘
```

规则：
- `skin.owned === true` → 右上角显示绿丝带「已拥有」，**不显示**折扣/限时角标
- `skin.owned === false` → 显示折扣/限时角标（现有逻辑），**不显示**丝带

### 实现要点

`src/components/SkinCard.jsx`：

```jsx
{/* 右上角：已拥有 → 丝带；未拥有 → 折扣角标 */}
{x.owned ? (
  <span className="skin-card-ribbon">已拥有</span>
) : (
  (() => {
    const parts = []
    if (x.limitedTime) parts.push('限时销售')
    if (x.discountPct > 0) parts.push('-' + x.discountPct + '%')
    if (x.saleEnd) { const m = String(x.saleEnd).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) parts.push(m[2] + '-' + m[3] + '结束') }
    return parts.length ? <span className="skin-card-flag">{parts.join(' ')}</span> : null
  })()
)}
```

`src/styles.css` 新增 `.skin-card-ribbon`，**视觉参数完全复用** `.mini-skin-ribbon`：

```css
.skin-card-ribbon {
  position: absolute; top: 14px; right: -28px; width: 104px;
  transform: rotate(45deg); text-align: center;
  font-size: 10px; font-weight: 800; line-height: 18px; color: #fff;
  background: linear-gradient(135deg, #2f9e44, #1f7a32);
  box-shadow: 0 2px 6px rgba(0,0,0,.4); pointer-events: none;
  z-index: 2;
}
```

尺寸按卡片宽度（260px）等比放大（小卡是 140px 左右宽，丝带 88px / 16px 高）。

### 注意
- 丝带必须 `pointer-events: none`，否则会挡住卡片的点击
- `z-index` 要高于 `.skin-card-bg`

### 涉及文件
- `src/components/SkinCard.jsx`
- `src/styles.css`

---

## 需求 4：底部空白 — 方案 A（垂直居中）

### 目标

只做垂直居中，不引入任何新元素。

### 现状

`src/pages/OverviewPage.jsx` 的 `.ov-bottom`（约 32% 高度）里只有 `.ds-box`（输入框），输入框贴在顶部，下方大片空白。

相关 CSS（`src/styles.css` 第 1155 行附近）：

```css
/* 现状 */
.ov-bottom { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
```

注意还有一条覆盖规则在文件末尾（搜 `.ov-bottom { justify-content: flex-start; }` 和 `.ds-box { margin-bottom: auto; }`），两处都要改。

### 改成

```css
.ov-bottom {
  display: flex;
  flex-direction: column;
  justify-content: center;   /* 垂直居中 */
  align-items: stretch;
}
.ds-box {
  margin-bottom: 0;          /* 去掉原来的 auto */
  flex: 0 0 auto;
}
```

### 验收
- 输入框在下方 32% 区域里上下留白相等
- 输入框本身高度不变（约 120px）
- 窗口缩放时保持居中

### 涉及文件
- `src/styles.css`（只改 `.ov-bottom` 和 `.ds-box` 的布局属性）

---

## 需求 5：推荐值旁边去掉问号

### 现状

皮肤卡片底部：

```
推荐 178 [?]     ← 问号按钮
```

两个都能点开明细（`ScorePopover`），问号是冗余的。

### 改成

```
推荐 178          ← 只保留数字可点
```

### 实现

`src/components/SkinCard.jsx` 删掉 `.score-help` 那个 button：

```jsx
{sc ? (
  <span className="score-chip">
    <button className="score-num" onClick={...} title="查看推荐值明细">
      <span className="score-label">推荐</span>
      {sc.total}
    </button>
    {/* 删除这个：
    <button className="score-help" ...>?</button>
    */}
  </span>
) : null}
```

### 保留问号的地方

`src/components/AnalysisModal.jsx` 的**对比结果弹窗标题旁**那个 `?` 保留（那里是打开完整公式面板的入口，不是重复的）。

### 涉及文件
- `src/components/SkinCard.jsx`

---

## 执行顺序

```
1. 需求 5（删问号）        —— 最小改动，先做
2. 需求 3（丝带复用）      —— 纯 SkinCard + CSS
3. 需求 4（垂直居中）      —— 纯 CSS
4. 需求 1（快速视图两项）   —— 跨 FilterPanel + StorePage
5. 需求 2（只改一句文案）
```

每步做完跑 `npx vite build` + `node .tmp/selfcheck.js 9222`。

---

## 参考文件清单

| 用途 | 路径 |
|---|---|
| 术语 / 组件规范 / 配色 / 字号 | `DESIGN.md` |
| 皮肤卡片（竖版，全局唯一） | `src/components/SkinCard.jsx` |
| 皮肤小卡（横版，全局唯一） | `src/components/SkinMiniCard.jsx` |
| 丝带样式参考（小卡） | `src/styles.css` 搜 `.mini-skin-ribbon` |
| 稀有度 rank 表 | `core/lcu/catalog.js` 第 13 行 `RARITY` |
| 筛选面板 | `src/components/FilterPanel.jsx` |
| 皮肤页主逻辑 | `src/pages/StorePage.jsx` |
| 总览页 | `src/pages/OverviewPage.jsx` |
| 常玩英雄排序 | `src/pages/OverviewPage.jsx:166` 的 `favs` useMemo |
| 成就数据（已删对局） | `core/usage.js` |
| 自检脚本 | `.tmp/selfcheck.js` |
| 只读审计 | `tools/audit_readonly.js`（`npm run audit`） |

---

## 启动 / 验证命令

```powershell
# 构建
npx vite build

# 重启应用（提权）
Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile","-Command","taskkill /F /IM electron.exe 2>`$null; Start-Sleep 2"
Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","<项目>\.tmp\launch-elevated.ps1"

# 自检（组件 import + 三页面渲染 + 控制台错误）
node .tmp/selfcheck.js 9222

# 只读审计（必须保持干净）
npm run audit
```

**注意**：`.tmp/launch-elevated.ps1` 里启动的 electron 带 `--remote-debugging-port=9222`。

---

## 已知约束（不要违反）

1. **绝不启动客户端** —— 只读数据，`npm run audit` 会检查
2. **皮肤卡片 / 皮肤小卡不能有第三套** —— 见 `DESIGN.md`
3. **不要用 emoji 或文字符号做图标** —— 只用 `src/components/Icon.jsx` 里的 SVG
4. **改完必须在真实应用里验证**，不能只看构建通过（Vite 不检查未定义变量，`SkinCard is not defined` 那种错误构建时不报）
5. **不要在用户正在用的应用上跑写操作的自动化测试** —— 用独立 `%APPDATA%` 目录起测试实例
