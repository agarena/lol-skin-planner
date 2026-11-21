import { useEffect, useState, useMemo } from 'react'
import { rarityClass, rarityHex, tileUrl, fmtRp, ROLE_LABELS } from '../lib.js'
import Thumb from '../components/Thumb.jsx'
import FilterPanel from '../components/FilterPanel.jsx'
import ChampSkinPopover from '../components/ChampSkinPopover.jsx'
import NotConnected from '../components/NotConnected.jsx'
import { IconSearch } from '../components/Icon.jsx'
import LoadingState from '../components/LoadingState.jsx'
import SkinCard from '../components/SkinCard.jsx'
import {
  buildChampInfoMap,
  buildChromaMap,
  loadStoreItems,
  toSkinCardSkin,
} from '../lib/skinCardData.js'
import ScorePopover from '../components/ScorePopover.jsx'
import { buildCtxMap, scoreOf } from '../lib/score.js'

const VIEWS = [
  { key: 'all', label: '全部皮肤' },
  { key: 'mythic', label: '神话商店' },
  { key: 'featured', label: '精品推荐' },
  { key: 'sale', label: '限时打折' },
  { key: 'limitedTime', label: '限时销售' },
  { key: 'legacy', label: '限定' },
  { key: 'newest', label: '最新上市' },
]

const EMPTY_FILTERS = {
  state: 'all',
  acquire: 'all',
  activity: new Set(),
  championIds: [],
  roles: [],
  tiers: [],
  masteryBand: '',
  lines: new Set(),
  rarities: new Set(),
  legacy: false,
  years: new Set(),
  ownedChroma: false,
  ownedPrestige: false,
}

/** 把 filters 应用到商城条目 */
function applyFilters(items, f, ctx) {
  const { chromaMap, usageMap, statsMap } = ctx
  return items.filter((x) => {
    if (f.state !== 'all' && x.state !== f.state) return false

    if (f.acquire === 'inStore' && !x.purchasable) return false
    if (f.acquire === 'notPurchasable' && x.purchasable) return false
    if (f.acquire === 'limitedTime' && !x.limitedTime) return false

    if (f.activity.size) {
      const hit = [...f.activity].some((k) => (k === 'mythicSale' ? !!x.mythicSale : !!x.onSale))
      if (!hit) return false
    }

    if (f.championIds.length && !f.championIds.includes(x.championId)) return false
    if (f.roles.length) {
      const c = ctx.champById[x.championId]
      if (!c || !(c.roles || []).some((r) => f.roles.includes(String(r).toUpperCase()))) return false
    }
    if (f.tiers.length) {
      const st = statsMap[x.championId]
      const tier = st && st.ranked ? st.ranked.tier : null
      if (tier == null || !f.tiers.includes(tier)) return false
    }
    if (f.masteryBand) {
      const lv = (usageMap[x.championId] && usageMap[x.championId].masteryLevel) || 0
      if (f.masteryBand === 'lv10' && lv < 10) return false
      if (f.masteryBand === 'lv5' && (lv < 5 || lv >= 10)) return false
      if (f.masteryBand === 'lv0' && lv >= 5) return false
    }
    if (f.lines.size && !(x.lines || []).some((l) => f.lines.has(l))) return false
    if (f.rarities.size && !f.rarities.has(x.rarity)) return false
    if (f.legacy && !x.legacy) return false

    if (f.years.size) {
      const y = x.releaseDate ? new Date(x.releaseDate).getFullYear() : null
      const yk = y ? (y <= 2020 ? '2020-' : String(y)) : 'unknown'
      if (!f.years.has(yk)) return false
    }

    if (f.ownedChroma) {
      const cm = chromaMap[x.skinId]
      if (!cm || !cm.chromaOwned) return false
    }
    if (f.ownedPrestige) {
      const cm = chromaMap[x.skinId]
      if (!cm || !cm.prestigeOwned) return false
    }
    return true
  })
}

export default function StorePage({ connected, status, onRefresh, onElevate, collection, usage, stats, planFilter, onPlanFilter }) {
  const [view, setView] = useState(() => {
    const v = new URLSearchParams(location.search).get('view')
    return v || 'all'
  })
  const [onlyUnowned, setOnlyUnowned] = useState(false)
  const [onlyZeroSkin, setOnlyZeroSkin] = useState(false)
  const [onlyNoEpic, setOnlyNoEpic] = useState(false)
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [limit, setLimit] = useState(120)
  const [mythic, setMythic] = useState(null)
  const [mythicErr, setMythicErr] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [groupMode, setGroupMode] = useState(() => {
    const v = typeof location !== 'undefined' && new URLSearchParams(location.search).get('group')
    return v || 'year'
  })
  const [champPop, setChampPop] = useState(() => {
    // 调试/截图用：?pop=<championId> 自动打开英雄浮层
    const v = typeof location !== 'undefined' && new URLSearchParams(location.search).get('pop')
    return v ? Number(v) : null
  })

  // 神话商店来自 itemshop.gg（LCU 没有这个数据），只在切到该视图时拉
  useEffect(() => {
    if (view !== 'mythic' || mythic || !connected) return
    window.lol.storeMythic({}).then((r) => {
      if (r.ok && r.data.available) setMythic(r.data)
      else setMythicErr((r.data && r.data.reason) || r.error || '拉取失败')
    })
  }, [view, mythic, connected])

  // 方案列表（筛选面板用）：连接状态变化 / 每次切回皮肤页都刷新
  const [plans, setPlans] = useState([])
  const [planTick, setPlanTick] = useState(0)
  useEffect(() => {
    if (!window.lol || !window.lol.listPlans) return
    let alive = true
    window.lol.listPlans().then((r) => {
      if (alive && r && r.ok) setPlans(r.data.plans || [])
    })
    return () => {
      alive = false
    }
  }, [connected, planTick])

  // 外部（对比页/方案页）跳转过来时，确保方案列表已加载
  useEffect(() => {
    if (planFilter) setPlanTick((n) => n + 1)
  }, [planFilter])

  useEffect(() => {
    if (!connected) return
    let alive = true
    setLoading(true)
    setErr(null)
    loadStoreItems().then((r) => {
      if (!alive) return
      if (r.ok) setData(r.data)
      else setErr(r.error)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [connected])

  // 炫彩/臻彩拥有情况（与方案页、英雄浮层共用同一份）
  const chromaMap = useMemo(() => buildChromaMap(collection), [collection])

  // 英雄维度信息（与方案页、英雄浮层共用同一份）
  const champInfoMap = useMemo(
    () => buildChampInfoMap(collection, usage, stats),
    [collection, usage, stats]
  )

  const priceBySkinId = useMemo(() => {
    const m = {}
    for (const x of (data && data.items) || []) m[x.skinId] = x
    return m
  }, [data])

  const champById = useMemo(() => {
    const m = {}
    for (const c of (collection && collection.champions) || []) m[c.id] = c
    return m
  }, [collection])

  const usageMap = (usage && usage.byChampion) || {}
  const statsMap = (stats && stats.byChampion) || {}
  const ctxMap = useMemo(() => buildCtxMap(collection, usage, stats), [collection, usage, stats])
  const [scorePop, setScorePop] = useState(null) // 正在看明细的皮肤

  const list = useMemo(() => {
    if (!data) return []
    const kw = q.trim().toLowerCase()
    // 方案筛选：选中方案时只保留方案里的皮肤（与快速视图互斥，但可叠加其他筛选）
    const planSkinIds = (() => {
      if (!planFilter) return null
      const p = plans.find((x) => x.id === planFilter)
      return p && p.skinIds ? new Set(p.skinIds) : null
    })()

    let out = data.items.filter((x) => {
      if (planSkinIds && !planSkinIds.has(x.skinId)) return false
      if (view === 'featured' && !x.featured) return false
      if (view === 'limitedTime' && !x.limitedTime) return false
      if (view === 'sale' && !x.onSale) return false
      if (view === 'legacy' && !x.legacy) return false
      if (view === 'inStore' && !x.purchasable) return false
      if (view === 'notPurchasable' && x.purchasable) return false
      if (view === 'mythicSale' && !x.mythicSale) return false
      if (onlyUnowned && x.owned) return false
      // 零皮肤英雄：已拥有英雄，且已拥有皮肤数为 0
      if (onlyZeroSkin) {
        const ci = champInfoMap[x.championId]
        if (!ci || !ci.owned || ci.skinOwned > 0) return false
      }
      // 无史诗及以上：已拥有英雄，且已拥有皮肤中 rank >= 3 的数量为 0
      // 零皮肤英雄也满足该条件，不能被排除
      if (onlyNoEpic) {
        const ci = champInfoMap[x.championId]
        if (!ci || !ci.owned || (ci.maxOwnedRank || 0) >= 3) return false
      }
      if (kw && !(x.name.toLowerCase().includes(kw) || (x.championName || '').toLowerCase().includes(kw))) return false
      return true
    })
    if (view === 'newest') out = out.slice().sort((a, b) => (b.releaseDate || 0) - (a.releaseDate || 0))
    return applyFilters(out, filters, { chromaMap, usageMap, statsMap, champById })
  }, [data, view, onlyUnowned, onlyZeroSkin, onlyNoEpic, q, filters, chromaMap, usageMap, statsMap, champById, champInfoMap, planFilter, plans])

  const shown = useMemo(() => list.slice(0, limit), [list, limit])

  // 分组：返回 [{ key, title, groups: [{ key, title, items }] }]
  // 套装模式：宇宙=大标题，套装=小标题；英雄模式：定位=大标题，英雄=小标题
  const grouped = useMemo(() => {
    const byNew = (a, b) => (b.releaseDate || 0) - (a.releaseDate || 0)

    const base = shown // 统一用分页后的数据，避免一次渲染上千张卡片
    if (groupMode === 'none' || !list.length) {
      return [{ key: 'all', title: '', groups: [{ key: 'all', title: '', items: shown }] }]
    }

    // 按推荐值分档
    if (groupMode === 'score') {
      const bands = [
        { key: 's400', min: 400, title: '400 分以上' },
        { key: 's200', min: 200, title: '200–399 分' },
        { key: 's100', min: 100, title: '100–199 分' },
        { key: 's50', min: 50, title: '50–99 分' },
        { key: 's0', min: -Infinity, title: '50 分以下' },
      ]
      const scored = base.map((x) => {
        const chMap = chromaMap[x.skinId]
        const ci = champInfoMap[x.championId]
        const sc = scoreOf(
          {
            ...x,
            id: x.skinId,
            price: { originalRp: x.originalRp },
            releaseLabel: x.releaseLabel,
            releaseAt: x.releaseDate,
          },
          {
            ownedByRarity: ctxMap.byRarity[x.championId] || {},
            chromaOwned: chMap ? chMap.chromaOwned : 0,
            prestigeOwned: chMap ? chMap.prestigeOwned : 0,
            champSkinOwned: ci ? ci.skinOwned : 0,
            masteryLevel: ci ? ci.masteryLevel : 0,
          }
        )
        return { x, total: sc.total }
      })
      const groups = []
      for (const b of bands) {
        const items = scored.filter((s) => {
          const nxt = bands[bands.indexOf(b) - 1]
          if (b.min === -Infinity) return s.total < 50
          if (nxt) return s.total >= b.min && s.total < nxt.min
          return s.total >= b.min
        })
        if (!items.length) continue
        groups.push({
          key: b.key,
          title: b.title + '（' + items.length + '）',
          items: items.sort((p, q) => q.total - p.total).map((s) => s.x),
        })
      }
      return [{ key: 'sg', title: '', groups }]
    }

    if (groupMode === 'year') {
      const map = new Map()
      for (const x of base) {
        const y = x.releaseDate ? new Date(x.releaseDate).getFullYear() : null
        const key = y ? String(y) : '未知'
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(x)
      }
      const keys = [...map.keys()].sort((a, b) => {
        if (a === '未知') return 1
        if (b === '未知') return -1
        return Number(b) - Number(a)
      })
      return [
        {
          key: 'yg',
          title: '',
          groups: keys.map((k) => ({
            key: 'y-' + k,
            title: k === '未知' ? '未知年份' : k + ' 年',
            items: map.get(k).slice().sort(byNew),
          })),
        },
      ]
    }

    if (groupMode === 'rarity') {
      const order = ['kMythic', 'kExalted', 'kTranscendent', 'kUltimate', 'kLegendary', 'kEpic', 'kRare', 'kNoRarity', '']
      const map = new Map()
      for (const x of base) {
        const k = x.rarity || ''
        if (!map.has(k)) map.set(k, [])
        map.get(k).push(x)
      }
      return [
        {
          key: 'rg',
          title: '',
          groups: order
            .filter((k) => map.has(k))
            .map((k) => ({
              key: 'r-' + k,
              title: (map.get(k)[0] && map.get(k)[0].rarityLabel) || '其他',
              items: map.get(k).slice().sort(byNew),
            })),
        },
      ]
    }

    if (groupMode === 'set') {
      // 宇宙 → 套装 两级
      const uniMap = new Map()
      for (const x of base) {
        const uni = (x.universes && x.universes[0]) || '其他宇宙'
        const line = (x.lines && x.lines[0]) || '无套装'
        if (!uniMap.has(uni)) uniMap.set(uni, new Map())
        const lineMap = uniMap.get(uni)
        if (!lineMap.has(line)) lineMap.set(line, [])
        lineMap.get(line).push(x)
      }
      return [...uniMap.entries()]
        .map(([uni, lineMap]) => {
          const sets = [...lineMap.entries()]
            .map(([line, items]) => ({ key: 'l-' + line, title: line, items: items.slice().sort(byNew) }))
            .sort((a, b) => b.items.length - a.items.length)
          const total = sets.reduce((n, s) => n + s.items.length, 0)
          return { key: 'u-' + uni, title: uni, count: total, groups: sets }
        })
        .sort((a, b) => b.count - a.count)
    }

    if (groupMode === 'champion_mastery') {
      // 成就等级 → 英雄 两级（每 5 级一档，0 个英雄的档位不显示）
      const bandOf = (lv) => {
        if (!lv || lv <= 0) return -1
        return Math.floor((lv - 1) / 5) * 5
      }
      const bandLabel = (lo) => (lo < 0 ? '无成就' : 'LV.' + (lo + 1) + '-' + (lo + 5))
      const bandMap = new Map()
      for (const x of base) {
        const info = champInfoMap[x.championId]
        const lv = info && info.masteryLevel ? info.masteryLevel : 0
        const lo = bandOf(lv)
        if (!bandMap.has(lo)) bandMap.set(lo, new Map())
        const champMap = bandMap.get(lo)
        if (!champMap.has(x.championId)) champMap.set(x.championId, { name: x.championName, lv, items: [] })
        champMap.get(x.championId).items.push(x)
      }
      return [...bandMap.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([lo, champMap]) => {
          const champs = [...champMap.entries()]
            .map(([cid, v]) => ({
              key: 'cm-' + cid,
              title: v.lv ? v.name + '　LV.' + v.lv : v.name,
              items: v.items.slice().sort(byNew),
            }))
            .sort((a, b) => b.items.length - a.items.length)
          const total = champs.reduce((n, s) => n + s.items.length, 0)
          return { key: 'mb-' + lo, title: bandLabel(lo), count: total, groups: champs }
        })
    }

    if (groupMode === 'champion') {
      // 定位 → 英雄 两级
      const roleMap = new Map()
      for (const x of base) {
        const c = champById[x.championId]
        const role = c && c.roles && c.roles.length ? c.roles[0] : 'OTHER'
        if (!roleMap.has(role)) roleMap.set(role, new Map())
        const champMap = roleMap.get(role)
        if (!champMap.has(x.championId)) champMap.set(x.championId, { name: x.championName, items: [] })
        champMap.get(x.championId).items.push(x)
      }
      return [...roleMap.entries()]
        .map(([role, champMap]) => {
          const champs = [...champMap.entries()]
            .map(([cid, v]) => ({ key: 'c-' + cid, title: v.name, items: v.items.slice().sort(byNew) }))
            .sort((a, b) => b.items.length - a.items.length)
          const total = champs.reduce((n, s) => n + s.items.length, 0)
          return { key: 'ro-' + role, title: ROLE_LABELS[role] || '其他', count: total, groups: champs }
        })
        .sort((a, b) => b.count - a.count)
    }

    return [{ key: 'all', title: '', groups: [{ key: 'all', title: '', items: shown }] }]
  }, [shown, list, groupMode, champById, champInfoMap])
  // 首次加载（还没有任何数据）→ 全屏居中提示，明确告知在读取
  if (loading && !data) {
    return <LoadingState title="正在读取商城数据" hint="首次加载需要 1~2 秒，之后会缓存，切页不再等待" />
  }

  if (!connected) {
    return <NotConnected status={status} onRefresh={onRefresh} onElevate={onElevate} hint="连接客户端后，这里会列出全部 1967 款皮肤、在售状态、折扣与活动" />
  }

  return (
    <div className="store-layout">
      <FilterPanel
        items={data ? data.items : []}
        champions={(collection && collection.champions) || []}
        usage={usage}
        stats={stats}
        filters={filters}
        onChange={setFilters}
        view={view}
        setView={(v) => { setView(v); if (onPlanFilter) onPlanFilter(null) }}
        plans={plans}
        planId={planFilter || null}
        setPlanId={(id) => {
          if (onPlanFilter) onPlanFilter(id)
          if (id) setView('all') // 选方案时重置快速视图，两者互斥
        }}
        q={q}
        setQ={setQ}
        onlyUnowned={onlyUnowned}
        setOnlyUnowned={setOnlyUnowned}
        onlyZeroSkin={onlyZeroSkin}
        setOnlyZeroSkin={setOnlyZeroSkin}
        onlyNoEpic={onlyNoEpic}
        setOnlyNoEpic={setOnlyNoEpic}
      />
      <div className="store-main">
      <div className="store-head">
        <span className="small dim">
          {loading ? '读取中…' : `${list.length} 款`}
          {view !== 'all' ? ' · ' + ((VIEWS.find((v) => v.key === view) || {}).label || '') : ''}
          {onlyUnowned ? ' · 仅未拥有' : ''}
        </span>
        <div className="spacer" />
        <label className="row small dim" style={{ gap: 6 }}>
          排序
          <select className="select" style={{ width: 132 }} value={groupMode} onChange={(e) => setGroupMode(e.target.value)}>
            <option value="score">推荐值</option>
            <option value="year">时间</option>
            <option value="rarity">品质</option>
            <option value="champion">英雄（定位）</option>
            <option value="champion_mastery">英雄（成就）</option>
            <option value="set">系列</option>
          </select>
        </label>
      </div>

      {err ? <div className="empty small">读取商城失败：{err}</div> : null}

      {view === 'mythic' ? <MythicBoard data={mythic} error={mythicErr} /> : null}

      {view !== 'mythic' ? (
      <>
      {grouped.map((g) => (
        <section key={g.key} className="skin-group">
          {g.title ? (
            <div className="group-h1">
              <span className="h1-title">{g.title}</span>
              {g.count != null ? <span className="h1-count">{g.count}</span> : null}
            </div>
          ) : null}
          {g.groups.map((sg) => (
          <div key={sg.key} className="skin-subgroup">
          {sg.title && sg.title !== g.title ? (
            <div className="group-h2">
              <span className="h2-title">{sg.title}</span>
              <span className="h2-count">{sg.items.length}</span>
            </div>
          ) : null}
          <div className="skin-grid">
        {sg.items.slice(0, 60).map((x) => {
          const ci = champInfoMap[x.championId] || null
          const chMap = chromaMap[x.skinId] || null
          // 截止日期：限时销售(下架) 与 限时打折(折扣结束) 取最早的一个
          const deadlines = []
          if (x.limitedTime && x.inactiveDate) deadlines.push({ at: Date.parse(x.inactiveDate), label: '下架' })
          if (x.onSale && x.saleEnd) deadlines.push({ at: Date.parse(x.saleEnd), label: '折扣结束' })
          const deadline = deadlines.filter((d) => d.at).sort((a, b) => a.at - b.at)[0] || null

          return (
            <SkinCard
              key={x.skinId}
              skin={toSkinCardSkin(x)}
              champInfo={champInfoMap[x.championId]}
              chromaInfo={chromaMap[x.skinId]}
              ctxMap={ctxMap}
              onOpenChamp={() => setChampPop(x.championId)}
              onScore={(s) => setScorePop(s)}
            />
          )
        })}
          </div>
          </div>
          ))}
        </section>
      ))}

      {shown.length < list.length ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn" onClick={() => setLimit((n) => n + 240)}>
            再显示 240 款（还有 {list.length - shown.length}）
          </button>
        </div>
      ) : null}

      {!loading && !list.length && !err ? (
        <div className="empty">
          <div className="empty-icon"><IconSearch size={40} /></div>
          <div>这个筛选条件下没有皮肤</div>
        </div>
      ) : null}
      </>
      ) : null}
      </div>

      {champPop ? (
        <ChampSkinPopover
          champion={(collection && collection.champions || []).find((c) => c.id === champPop) || null}
          priceBySkinId={priceBySkinId}
          champInfoMap={champInfoMap}
          chromaMap={chromaMap}
          ctxMap={ctxMap}
          onScore={(s) => setScorePop(s)}
          onClose={() => setChampPop(null)}
        />
      ) : null}

      {scorePop ? (
        <ScorePopover
          skin={scorePop}
          ctx={{
            ownedByRarity: ctxMap.byRarity[scorePop.championId] || {},
            chromaOwned: (ctxMap.byChroma[scorePop.id] || {}).chromaOwned || 0,
            prestigeOwned: (ctxMap.byChroma[scorePop.id] || {}).prestigeOwned || 0,
            champSkinOwned: (ctxMap.byChamp[scorePop.championId] || {}).skinOwned || 0,
            masteryLevel: (ctxMap.byChamp[scorePop.championId] || {}).masteryLevel || 0,
          }}
          onClose={() => setScorePop(null)}
        />
      ) : null}
    </div>
  )
}

/** 神话商店：数据来自 itemshop.gg，按 featured / biweekly 分区展示 */
function MythicBoard({ data, error }) {
  if (error) {
    return (
      <div className="empty small">
        <div>神话商店拉取失败：{error}</div>
        <div className="dim">这个模块依赖联网（itemshop.gg），本地 LCU 没有神话商店数据</div>
      </div>
    )
  }
  if (!data) {
    return <div className="empty"><div className="spin" /></div>
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row small dim" style={{ marginBottom: 10, gap: 10 }}>
        <span>商店日期 {data.shopDate}</span>
        <span>·</span>
        <span>共 {data.itemCount} 项</span>
        <span>·</span>
        <span>神话商店 {data.mythic.total} 项（未拥有 {data.mythic.unowned}）</span>
        <div className="spacer" />
        <a href={data.attribution.url} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
          {data.attribution.label}
        </a>
      </div>

      {data.mythic.sections.map((sec) => (
        <div key={sec.title} style={{ marginBottom: 18 }}>
          <div className="tier-head" style={{ marginBottom: 8 }}>
            <div className="tier-badge tier-A" style={{ fontSize: 12 }}>M</div>
            <div>
              <div className="tier-title">{sec.title.replace('Mythic Shop: ', '神话商店 · ')}</div>
              <div className="tier-sub">{sec.items.filter((it) => it.skinId).length} 款皮肤 · 用神话精萃兑换</div>
            </div>
          </div>
          <div className="plan-grid">
            {sec.items.filter((it) => it.skinId).map((it) => (
              <div key={it.englishName + it.amount} className={'plan-card' + (it.owned ? ' skip' : '')} style={{ cursor: 'default' }}>
                <img className="plan-thumb" src={it.image || ''} alt="" loading="lazy" style={{ objectFit: 'cover' }} />
                <div className="plan-body">
                  <div className="plan-title" title={it.englishName}>{it.name}</div>
                  <div className="plan-champ row" style={{ gap: 6 }}>
                    <span>{it.type}</span>
                    {it.rarityLabel ? <span className={'rb ' + rarityClass('')}>{it.rarityLabel}</span> : null}
                    {it.owned ? <span className="owned-mark">已拥有</span> : null}
                    {!it.matched ? <span className="dim" title={it.englishName}>未匹配中文</span> : null}
                  </div>
                  <div className="plan-price">
                    <span className="price-now">{it.amount}</span>
                    <span className="small" style={{ color: 'var(--purple)' }}>
                      {it.currency === 'Mythic Essence' ? '神话精萃' : it.currency}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
