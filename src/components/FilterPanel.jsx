import { useMemo, useState } from 'react'
import ChampAvatar from '../components/ChampAvatar.jsx'

const ROLES = [
  { key: 'FIGHTER', label: '战士' },
  { key: 'MAGE', label: '法师' },
  { key: 'ASSASSIN', label: '刺客' },
  { key: 'TANK', label: '坦克' },
  { key: 'MARKSMAN', label: '射手' },
  { key: 'SUPPORT', label: '辅助' },
]

const RARITIES = [
  { key: 'kNoRarity', label: '普通' },
  { key: 'kRare', label: '稀有' },
  { key: 'kEpic', label: '史诗' },
  { key: 'kLegendary', label: '传说' },
  { key: 'kMythic', label: '神话' },
  { key: 'kUltimate', label: '终极' },
  { key: 'kExalted', label: '卓越' },
  { key: 'kTranscendent', label: '圣堂' },
]

const STATE_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'owned', label: '已拥有' },
  { key: 'none', label: '未拥有' },
  { key: 'lootShard', label: '有碎片' },
  { key: 'lootPermanent', label: '战利品可解锁' },
]

const ACQUIRE_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'inStore', label: '商城常驻' },
  { key: 'notPurchasable', label: '非点券直购' },
  { key: 'limitedTime', label: '限时销售' },
]

/** 可折叠分组：≤ limit 项全显示 */
function Group({ title, badge, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="fg">
      <button className="fg-head" onClick={() => setOpen((v) => !v)}>
        <span className="fg-title">{title}</span>
        {badge != null ? <span className="fg-badge">{badge}</span> : null}
        <span className={'fg-arrow' + (open ? ' open' : '')}>▾</span>
      </button>
      {open ? <div className="fg-body">{children}</div> : null}
    </section>
  )
}

/** 单选项 */
function Radio({ options, value, onChange, counts }) {
  return (
    <div className="fg-list">
      {options.map((o) => (
        <button
          key={o.key}
          className={'fg-opt' + (value === o.key ? ' on' : '')}
          onClick={() => onChange(o.key)}
        >
          <span className="radio-dot" />
          <span className="fg-label">{o.label}</span>
          {counts && counts[o.key] != null ? <span className="fg-count">{counts[o.key]}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** 多选项 */
function Checks({ options, values, onToggle, counts, limit = 8 }) {
  const [expanded, setExpanded] = useState(false)
  const list = expanded ? options : options.slice(0, limit)
  const more = options.length > limit
  return (
    <div className="fg-list">
      {list.map((o) => (
        <button
          key={o.key}
          className={'fg-opt' + (values.has(o.key) ? ' on' : '')}
          onClick={() => onToggle(o.key)}
        >
          <span className={'check-box' + (values.has(o.key) ? ' on' : '')} />
          <span className="fg-label">{o.label}</span>
          {counts && counts[o.key] != null ? <span className="fg-count">{counts[o.key]}</span> : null}
        </button>
      ))}
      {more ? (
        <button className="fg-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `展开全部（共 ${options.length} 项）`}
        </button>
      ) : null}
    </div>
  )
}

const QUICK_VIEWS = [
  { key: 'all', label: '全部皮肤' },
  { key: 'sale', label: '限时打折' },
  { key: 'limitedTime', label: '限时销售' },
]

/** 商城视图：与快速视图共用同一个 view 状态，选中后方案自动取消 */
const EXTRA_VIEWS = [
  { key: 'mythic', label: '神话商店' },
  { key: 'featured', label: '精品推荐' },
  { key: 'legacy', label: '限定' },
  { key: 'newest', label: '最新上市' },
]

export default function FilterPanel({
  items,
  champions,
  usage,
  stats,
  filters,
  onChange,
  view,
  setView,
  q,
  setQ,
  onlyUnowned,
  setOnlyUnowned,
  onlyZeroSkin,
  setOnlyZeroSkin,
  onlyNoEpic,
  setOnlyNoEpic,
  plans = [],
  planId,
  setPlanId,
}) {
  const [plansExpanded, setPlansExpanded] = useState(false)
  const set = (patch) => onChange({ ...filters, ...patch })

  // ---- 各项计数 ----
  const counts = useMemo(() => {
    const base = items || []
    const c = {
      state: { all: base.length },
      acquire: { all: base.length },
      activity: { mythicSale: 0, onSale: 0 },
      rarity: {},
      year: {},
      role: {},
      ownedChroma: 0,
      ownedPrestige: 0,
    }
    for (const x of base) {
      const st = x.state || 'none'
      c.state[st] = (c.state[st] || 0) + 1
      if (x.purchasable) c.acquire.inStore = (c.acquire.inStore || 0) + 1
      if (!x.purchasable) c.acquire.notPurchasable = (c.acquire.notPurchasable || 0) + 1
      if (x.limitedTime) c.acquire.limitedTime = (c.acquire.limitedTime || 0) + 1
      if (x.mythicSale) c.activity.mythicSale += 1
      if (x.onSale) c.activity.onSale += 1
      c.rarity[x.rarity] = (c.rarity[x.rarity] || 0) + 1
      const y = x.releaseDate ? new Date(x.releaseDate).getFullYear() : null
      const yk = y ? (y <= 2020 ? '2020-' : String(y)) : 'unknown'
      c.year[yk] = (c.year[yk] || 0) + 1
    }
    return c
  }, [items])

  // ---- 年份选项（2026 往下，2020 及以前合并）----
  const yearOptions = useMemo(() => {
    const years = Object.keys(counts.year || {})
      .filter((y) => y !== 'unknown')
      .sort((a, b) => (a === '2020-' ? 1 : b === '2020-' ? -1 : Number(b) - Number(a)))
    return years.map((y) => ({ key: y, label: y === '2020-' ? '2020 及以前' : y }))
  }, [counts.year])

  // ---- 英雄：常玩 / 零皮肤 / 全部 ----
  const champList = champions || []
  const usageMap = (usage && usage.byChampion) || {}
  const statsMap = (stats && stats.byChampion) || {}
  const zeroSkinCount = useMemo(
    () => champList.filter((c) => c.owned && (c.ownedSkinCount || 0) === 0).length,
    [champions]
  )
  const noEpicCount = useMemo(
    () => champList.filter((c) => c.owned && (c.maxOwnedRarityRank || 0) < 3).length,
    [champions]
  )

  const quickChampGroups = useMemo(() => {
    const owned = champList.filter((c) => c.owned)
    const frequent = owned
      .filter((c) => usageMap[c.id])
      .sort((a, b) => (usageMap[b.id].score || 0) - (usageMap[a.id].score || 0))
      .slice(0, 12)
    const zero = owned.filter((c) => c.ownedSkinCount === 0)
    return { frequent, zero, all: owned }
  }, [champList, usageMap])

  const [champMode, setChampMode] = useState('frequent')
  const [champQuery, setChampQuery] = useState('')
  const [champExpanded, setChampExpanded] = useState(false)

  const champCandidates = useMemo(() => {
    let list = quickChampGroups[champMode] || []
    if (champQuery.trim()) {
      const q = champQuery.trim().toLowerCase()
      list = quickChampGroups.all.filter(
        (c) => c.name.toLowerCase().includes(q) || String(c.alias || '').toLowerCase().includes(q)
      )
    }
    // 应用定位/梯度/成就过滤
    if (filters.roles.length) {
      list = list.filter((c) =>
        (c.roles || []).some((r) => filters.roles.includes(String(r).toUpperCase()))
      )
    }
    if (filters.tiers.length) {
      list = list.filter((c) => {
        const t = statsMap[c.id] && statsMap[c.id].ranked ? statsMap[c.id].ranked.tier : null
        return t != null && filters.tiers.includes(t)
      })
    }
    if (filters.masteryBand) {
      list = list.filter((c) => {
        const lv = (usageMap[c.id] && usageMap[c.id].masteryLevel) || 0
        if (filters.masteryBand === 'lv10') return lv >= 10
        if (filters.masteryBand === 'lv5') return lv >= 5 && lv < 10
        if (filters.masteryBand === 'lv0') return lv < 5
        return true
      })
    }
    return list
  }, [quickChampGroups, champMode, champQuery, filters, statsMap, usageMap])

  const visibleChamps = champExpanded ? champCandidates : champCandidates.slice(0, 8)

  const toggleArr = (key, v) => {
    const cur = filters[key]
    if (cur instanceof Set) {
      const next = new Set(cur)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      set({ [key]: next })
      return
    }
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
    set({ [key]: next })
  }

  return (
    <aside className="filter-panel">
      <div className="fp-scroll">
        <div className="fp-top">
          <input
            className="input fp-search"
            placeholder="搜索皮肤 / 英雄"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {/* 方案：与快速视图同级互斥，可选完再叠加其他筛选 */}
        {plans.length ? (
          <Group title="方案" count={plans.length}>
            <div className="fg-list">
              {(plansExpanded ? plans : plans.slice(0, 3)).map((p) => (
                <button
                  key={p.id}
                  className={'fg-opt' + (planId === p.id ? ' on' : '')}
                  onClick={() => setPlanId(planId === p.id ? null : p.id)}
                  title={p.name}
                >
                  <span className="radio-dot" />
                  <span className="fg-label fg-plan-name">{p.name}</span>
                  <span className="fg-count">{p.skinIds ? p.skinIds.length : 0}</span>
                </button>
              ))}
            </div>
            {plans.length > 3 ? (
              <button className="fg-more" onClick={() => setPlansExpanded((v) => !v)}>
                {plansExpanded ? '收起' : `展开全部（共 ${plans.length} 个）`}
              </button>
            ) : null}
          </Group>
        ) : null}

        <Group title="快速视图">
          <div className="fg-list">
            {QUICK_VIEWS.map((v) => (
              <button
                key={v.key}
                className={'fg-opt' + (!planId && view === v.key ? ' on' : '')}
                onClick={() => setView(v.key)}
              >
                <span className="radio-dot" />
                <span className="fg-label">{v.label}</span>
              </button>
            ))}
          </div>
          <button
            className={'fg-opt' + (onlyUnowned ? ' on' : '')}
            onClick={() => setOnlyUnowned(!onlyUnowned)}
            style={{ marginTop: 4 }}
          >
            <span className={'check-box' + (onlyUnowned ? ' on' : '')} />
            <span className="fg-label">只看未拥有</span>
          </button>
          <button
            className={'fg-opt' + (onlyZeroSkin ? ' on' : '')}
            onClick={() => setOnlyZeroSkin(!onlyZeroSkin)}
            style={{ marginTop: 4 }}
          >
            <span className={'check-box' + (onlyZeroSkin ? ' on' : '')} />
            <span className="fg-label">零皮肤英雄</span>
            <span className="fg-count">{zeroSkinCount}</span>
          </button>
          <button
            className={'fg-opt' + (onlyNoEpic ? ' on' : '')}
            onClick={() => setOnlyNoEpic(!onlyNoEpic)}
            style={{ marginTop: 4 }}
          >
            <span className={'check-box' + (onlyNoEpic ? ' on' : '')} />
            <span className="fg-label">无史诗及以上皮肤英雄</span>
            <span className="fg-count">{noEpicCount}</span>
          </button>
        </Group>

        <Group title="商城视图">
          <div className="fg-list">
            {EXTRA_VIEWS.map((v) => (
              <button
                key={v.key}
                className={'fg-opt' + (!planId && view === v.key ? ' on' : '')}
                onClick={() => setView(v.key)}
              >
                <span className="radio-dot" />
                <span className="fg-label">{v.label}</span>
              </button>
            ))}
          </div>
        </Group>

        <Group title="拥有状态" badge={counts.state[filters.state]}>
          <Radio options={STATE_OPTIONS} value={filters.state} onChange={(v) => set({ state: v })} counts={counts.state} />
        </Group>

        <Group title="获取方式">
          <Radio
            options={ACQUIRE_OPTIONS}
            value={filters.acquire}
            onChange={(v) => set({ acquire: v })}
            counts={counts.acquire}
          />
        </Group>

        <Group title="活动 · 折扣">
          <Checks
            options={[
              { key: 'mythicSale', label: '神话限时5折' },
              { key: 'onSale', label: '限时打折' },
            ]}
            values={filters.activity}
            onToggle={(k) => toggleArr('activity', k)}
            counts={counts.activity}
          />
        </Group>

        <Group title="英雄" badge={filters.championIds.length || null}>
          <input
            className="input fp-search"
            placeholder="搜索英雄"
            value={champQuery}
            onChange={(e) => setChampQuery(e.target.value)}
          />
          <div className="fp-chips">
            {['frequent', 'zero', 'all'].map((m) => (
              <button
                key={m}
                className={'fp-chip' + (champMode === m && !champQuery ? ' on' : '')}
                onClick={() => {
                  setChampMode(m)
                  setChampQuery('')
                }}
              >
                {m === 'frequent' ? '常玩' : m === 'zero' ? '零皮肤' : '全部'}
                <em>{quickChampGroups[m].length}</em>
              </button>
            ))}
          </div>

          {filters.championIds.length ? (
            <div className="fp-selected">
              {filters.championIds.map((id) => {
                const c = quickChampGroups.all.find((x) => x.id === id)
                if (!c) return null
                return (
                  <span key={id} className="fp-sel-chip" onClick={() => toggleArr('championIds', id)}>
                    {c.name} ×
                  </span>
                )
              })}
            </div>
          ) : null}

          <div className="fp-champ-grid">
            {visibleChamps.map((c) => (
              <button
                key={c.id}
                className={'fp-champ' + (filters.championIds.includes(c.id) ? ' on' : '')}
                title={c.name}
                onClick={() => toggleArr('championIds', c.id)}
              >
                <ChampAvatar id={c.id} name={c.name} size={28} radius={5} />
              </button>
            ))}
          </div>
          {champCandidates.length > 8 ? (
            <button className="fg-more" onClick={() => setChampExpanded((v) => !v)}>
              {champExpanded ? '收起' : `展开全部（共 ${champCandidates.length} 位）`}
            </button>
          ) : null}
          {!champCandidates.length ? <div className="small dim">没有符合条件的英雄</div> : null}

          <div className="fp-sub">
            <div className="fp-sub-title">定位</div>
            <div className="fp-inline">
              {ROLES.map((r) => (
                <button
                  key={r.key}
                  className={'fp-tag' + (filters.roles.includes(r.key) ? ' on' : '')}
                  onClick={() => toggleArr('roles', r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fp-sub">
            <div className="fp-sub-title">梯度</div>
            <div className="fp-inline">
              {[1, 2, 3, 4, 5].map((t) => (
                <button
                  key={t}
                  className={'fp-tag t' + t + (filters.tiers.includes(t) ? ' on' : '')}
                  onClick={() => toggleArr('tiers', t)}
                >
                  T{t}
                </button>
              ))}
            </div>
          </div>

          <div className="fp-sub">
            <div className="fp-sub-title">成就等级</div>
            <div className="fp-inline">
              {[
                { key: '', label: '全部' },
                { key: 'lv10', label: 'LV.10+' },
                { key: 'lv5', label: 'LV.5-9' },
                { key: 'lv0', label: 'LV.0-4' },
              ].map((b) => (
                <button
                  key={b.key || 'all'}
                  className={'fp-tag' + (filters.masteryBand === b.key ? ' on' : '')}
                  onClick={() => set({ masteryBand: b.key })}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fp-sub">

          </div>
        </Group>

        <Group title="皮肤系列" badge={filters.lines.size || null}>
          <SeriesPicker items={items} values={filters.lines} onChange={(next) => set({ lines: next })} />
        </Group>

        <Group title="稀有度">
          <Checks
            options={RARITIES}
            values={filters.rarities}
            onToggle={(k) => toggleArr('rarities', k)}
            counts={counts.rarity}
          />
          <button
            className={'fg-opt' + (filters.legacy ? ' on' : '')}
            style={{ marginTop: 4 }}
            onClick={() => set({ legacy: !filters.legacy })}
          >
            <span className={'check-box' + (filters.legacy ? ' on' : '')} />
            <span className="fg-label">限定</span>
          </button>
        </Group>

        <Group title="上线年份">
          <Checks options={yearOptions} values={filters.years} onToggle={(k) => toggleArr('years', k)} counts={counts.year} />
        </Group>

        <Group title="其他" defaultOpen={false}>
          <button
            className={'fg-opt' + (filters.ownedChroma ? ' on' : '')}
            onClick={() => set({ ownedChroma: !filters.ownedChroma })}
          >
            <span className={'check-box' + (filters.ownedChroma ? ' on' : '')} />
            <span className="fg-label">已拥有普通炫彩</span>
            <span className="fg-help" title="你拥有这款皮肤的普通炫彩。配合「未拥有」可筛出「有炫彩却没有原皮肤、用不上」的皮肤">
              ?
            </span>
          </button>
          <button
            className={'fg-opt' + (filters.ownedPrestige ? ' on' : '')}
            onClick={() => set({ ownedPrestige: !filters.ownedPrestige })}
          >
            <span className={'check-box' + (filters.ownedPrestige ? ' on' : '')} />
            <span className="fg-label">已拥有臻彩</span>
            <span className="fg-help" title="同上，但只统计臻彩（有独立原画的炫彩）">
              ?
            </span>
          </button>
        </Group>
      </div>
    </aside>
  )
}

/** 系列选择器：按系列内最新皮肤日期倒序，默认前 8 项 */
function SeriesPicker({ items, values, onChange }) {
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(false)

  const series = useMemo(() => {
    const map = new Map()
    for (const x of items || []) {
      for (const line of x.lines || []) {
        if (!map.has(line)) map.set(line, { name: line, count: 0, latest: 0 })
        const s = map.get(line)
        s.count += 1
        if (x.releaseDate && x.releaseDate > s.latest) s.latest = x.releaseDate
      }
    }
    return [...map.values()].sort((a, b) => b.latest - a.latest)
  }, [items])

  const filtered = q.trim() ? series.filter((s) => s.name.includes(q.trim())) : series
  const shown = expanded ? filtered : filtered.slice(0, 8)

  const toggle = (name) => {
    const next = new Set(values)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onChange(next)
  }

  return (
    <>
      <input className="input fp-search" placeholder="搜索系列" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="fg-list">
        {shown.map((s) => (
          <button key={s.name} className={'fg-opt' + (values.has(s.name) ? ' on' : '')} onClick={() => toggle(s.name)}>
            <span className={'check-box' + (values.has(s.name) ? ' on' : '')} />
            <span className="fg-label">{s.name}</span>
            <span className="fg-count">{s.count}</span>
          </button>
        ))}
      </div>
      {filtered.length > 8 ? (
        <button className="fg-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `展开全部（共 ${filtered.length} 项）`}
        </button>
      ) : null}
      {values.size ? (
        <button className="fg-more" onClick={() => onChange(new Set())}>
          清空系列筛选
        </button>
      ) : null}
    </>
  )
}
