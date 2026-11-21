import { useEffect, useMemo, useRef, useState } from 'react'
import { rarityClass, fmtRp, ROLE_LABELS } from '../lib.js'
import ChampAvatar from '../components/ChampAvatar.jsx'
import Thumb from '../components/Thumb.jsx'
import AnalysisModal from '../components/AnalysisModal.jsx'
import NotConnected from '../components/NotConnected.jsx'
import SkinMiniCard from '../components/SkinMiniCard.jsx'
import { IconPlus, IconArrowUp, IconImage } from '../components/Icon.jsx'

/** 稀有度宝石（名称 + 单图 / 精灵图标记） */
const GEM = {
  kUltimate: { n: 9, label: '终极' },
  kMythic: { n: 8, label: '神话' },
  kExalted: { n: 10, label: '卓越' },
  kTranscendent: { n: 11, label: '圣堂' },
  kLegendary: { n: 5, label: '传说' },
  kEpic: { n: null, label: '史诗' },
  kRare: { n: 7, label: '稀有' },
  kNoRarity: { n: 7, label: '普通' },
}
const GEM_ORDER = ['kUltimate', 'kMythic', 'kExalted', 'kTranscendent', 'kLegendary', 'kEpic', 'kRare', 'kNoRarity']

/** 一组英雄头像（可折叠） */
function ChampIconRow({ list, tierMap, max = 13 }) {
  const [open, setOpen] = useState(false)
  if (!list.length) return <div className="small dim">无</div>
  const shown = open ? list : list.slice(0, max)
  return (
    <>
      <div className="icon-row">
        {shown.map((c) => (
          <div key={c.id} className="icon-cell" title={`${c.name}${tierMap[c.id] ? ' · T' + tierMap[c.id] : ''}`}>
            <ChampAvatar id={c.id} name={c.name} size={32} radius={6} />
            {tierMap[c.id] ? <span className={'tier-chip t' + tierMap[c.id] + ' icon-tier'}>T{tierMap[c.id]}</span> : null}
          </div>
        ))}
      </div>
      {list.length > max ? (
        <button className="fg-more" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : `展开全部（${list.length} 位）`}
        </button>
      ) : null}
    </>
  )
}

/** 常玩英雄卡片：横向，头像+名称+等级，下面两行皮肤（3 已拥有 + 未拥有补满） */
function FavCard({ champ, tier, lv, ownedSkins, missingSkins, total, priceMap }) {
  // 已拥有：稀有度高的优先，同档取最新
  const ownedSorted = ownedSkins
    .slice()
    .sort((a, b) => (b.rarityRank || 0) - (a.rarityRank || 0) || (b.releaseAt || 0) - (a.releaseAt || 0))
    .slice(0, 3)

  // 未拥有：先按「有没有活动」分组，活动项优先，组内仍按新到旧
  const promoOf = (id) => {
    const p = priceMap && priceMap[id]
    if (!p) return null
    const parts = []
    if (p.limitedTime) parts.push('限时销售')
    if (p.discountPct > 0) parts.push('-' + p.discountPct + '%')
    else if (p.mythicSale) parts.push('-' + p.mythicSale.discountPct + '%')
    return parts.length ? { text: parts.join(' '), onSale: true } : null
  }

  const missingSorted = missingSkins
    .map((s) => ({ ...s, promo: promoOf(s.id) }))
    .sort((a, b) => {
      const pa = a.promo ? 1 : 0
      const pb = b.promo ? 1 : 0
      if (pa !== pb) return pb - pa // 有活动的排前面
      return (b.releaseAt || 0) - (a.releaseAt || 0) // 组内新到旧
    })

  const COL = 5
  const need = COL * 2 - ownedSorted.length
  const fill = missingSorted.slice(0, Math.max(0, need))
  const cells = [
    ...ownedSorted.map((s) => ({ ...s, owned: true })),
    ...fill.map((s) => ({ ...s, owned: false })),
  ]

  return (
    <div className="fav-card-v2">
      <div className="fc-head">
        <ChampAvatar id={champ.id} name={champ.name} size={36} radius={8} />
        <span className="fc-champ">{champ.name}</span>
        {tier ? <span className={'tier-chip t' + tier}>T{tier}</span> : null}
        {lv ? <span className="fc-lv">LV.{lv}</span> : null}
        <div className="spacer" />
        <span className="fc-count">
          {ownedSkins.length}/{total}
        </span>
      </div>

      <div className="fc-grid">
        {cells.map((s) => (
          <SkinMiniCard key={s.id + (s.owned ? '-o' : '-m')} skin={s} />
        ))}
        {!cells.length ? <div className="fc-empty">该英雄还没有皮肤</div> : null}
      </div>
    </div>
  )
}
const PLACEHOLDER =
  '输入你抽到的皮肤名称，结合皮肤质量与已拥有皮肤等数据，帮你选择更适合你的皮肤，如「山海绘卷 科加斯 ；逆命 塔里克」，也可以直接粘贴方案口令。'

export default function OverviewPage({ status, onRefresh, onElevate, collection, usage, stats, analysis, analysisPlanId, picked, onAnalyze, onTogglePick, onPickAll, analyzeBusy, onOpenSkins }) {
  const s = (collection && collection.stats) || {}
  const champs = (collection && collection.champions) || []
  const usageMap = (usage && usage.byChampion) || {}
  const statsMap = (stats && stats.byChampion) || {}

  const [text, setText] = useState('')
  const [imgNote, setImgNote] = useState('')
  const [modalStage, setModalStage] = useState(null) // null | confirm | result
  const [planName, setPlanName] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const confirmRef = useRef(null)
  const [matchItems, setMatchItems] = useState([]) // 解析出的皮肤
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [searchQ, setSearchQ] = useState('')
  const [allSkins, setAllSkins] = useState(null)
  const [priceMap, setPriceMap] = useState({})
  const [parsing, setParsing] = useState(false)

  // 商城数据：给「未拥有」皮肤标折扣/限时用（storeItems 有缓存，约 8ms）
  useEffect(() => {
    if (!window.lol || !window.lol.storeItems) return
    window.lol.storeItems({ view: 'all' }).then((r) => {
      if (!r || !r.ok) return
      const m = {}
      for (const x of r.data.items || []) m[x.skinId] = x
      setPriceMap(m)
    })
  }, [])

  const tierOf = (id) => (statsMap[id] && statsMap[id].ranked ? statsMap[id].ranked.tier : null)
  const tierMap = useMemo(() => {
    const m = {}
    for (const c of champs) m[c.id] = tierOf(c.id)
    return m
  }, [champs, statsMap])

  /* 稀有度完成度 */
  const gemStats = useMemo(() => {
    const all = []
    for (const c of champs) for (const sk of c.skins || []) if (!sk.isBase) all.push(sk)
    const map = new Map()
    for (const sk of all) {
      const r = sk.rarity || 'kNoRarity'
      if (!map.has(r)) map.set(r, { owned: 0, total: 0 })
      const e = map.get(r)
      e.total += 1
      if (sk.owned) e.owned += 1
    }
    return GEM_ORDER.filter((k) => map.has(k)).map((k) => ({
      key: k,
      label: (GEM[k] || {}).label || k,
      gem: (GEM[k] || {}).n || null,
      ...map.get(k),
    }))
  }, [champs])

  /* 常玩英雄 */
  const favs = useMemo(() => {
    return champs
      .map((c) => ({ ...c, u: usageMap[c.id] }))
      .filter((c) => c.owned && c.u)
      .sort((a, b) => (b.u.score || 0) - (a.u.score || 0))
      .slice(0, 6)
      .map((c) => {
        const skins = (c.skins || []).filter((x) => !x.isBase)
        const ownedSk = skins.filter((x) => x.owned).sort((a, b) => (b.releaseAt || 0) - (a.releaseAt || 0))
        const missSk = skins.filter((x) => !x.owned).sort((a, b) => (b.releaseAt || 0) - (a.releaseAt || 0))
        return { champ: c, ownedSk, missSk, total: skins.length, lv: c.u && c.u.masteryLevel, tier: tierOf(c.id) }
      })
  }, [champs, usageMap, statsMap])

  const zeroSkin = useMemo(
    () =>
      champs
        .filter((c) => c.owned && c.ownedSkinCount === 0)
        .sort((a, b) => ((usageMap[b.id] || {}).score || 0) - ((usageMap[a.id] || {}).score || 0)),
    [champs, usageMap]
  )
  const noEpic = useMemo(() => champs.filter((c) => c.owned && (c.maxOwnedRarityRank || 0) < 3), [champs])
  const noLegend = useMemo(() => champs.filter((c) => c.owned && (c.maxOwnedRarityRank || 0) < 4), [champs])

  // 调试用：?demo=1 自动填入示例并触发一次解析
  useEffect(() => {
    const q = typeof location !== 'undefined' && new URLSearchParams(location.search)
    if (!q || q.get('demo') !== '1') return
    const demoText = '山海绘卷 科加斯 ；逆命 塔里克'
    setText(demoText)
    const t1 = setTimeout(() => send(demoText), 2000)
    // ?demo=2 时再自动点「开始比较」，用来看结果表格
    const t2 = q.get('demo') === '2' ? setTimeout(() => confirmRef.current && confirmRef.current(), 7000) : null
    return () => { clearTimeout(t1); if (t2) clearTimeout(t2) }
  }, [])

  // 弹窗打分需要的上下文：英雄皮肤数 / 梯度 / 炫彩统计
  const ctxMap = useMemo(() => {
    const byChamp = {}
    const byTier = {}
    const byChroma = {}
    const byRarity = {}
    for (const c of champs) {
      const skins = (c.skins || []).filter((x) => !x.isBase)
      byChamp[c.id] = {
        skinOwned: c.ownedSkinCount || 0,
        skinTotal: skins.length,
        maxOwnedLabel: c.maxOwnedRarityLabel || '无',
        masteryLevel: (usageMap[c.id] && usageMap[c.id].masteryLevel) || 0,
      }
      const st = statsMap[c.id]
      byTier[c.id] = {
        ranked: st && st.ranked ? st.ranked.tier : null,
        aram: st && st.aram ? st.aram.tier : null,
      }
      // 每个英雄每个稀有度已有几件（给「同档重复惩罚」用）
      byRarity[c.id] = {}
      for (const sk of skins) {
        if (sk.owned) byRarity[c.id][sk.rarity] = (byRarity[c.id][sk.rarity] || 0) + 1
      }

      for (const sk of skins) {
        const list = sk.chromaList || []
        if (!list.length) continue
        let co = 0
        let po = 0
        for (const x of list) {
          if (!x.owned) continue
          if (x.prestige) po += 1
          else co += 1
        }
        byChroma[sk.id] = {
          chromaOwned: co,
          chromaTotal: list.filter((x) => !x.prestige).length,
          prestigeOwned: po,
          prestigeTotal: list.filter((x) => x.prestige).length,
        }
      }
    }
    return { byChamp, byTier, byChroma, byRarity }
  }, [champs, usageMap, statsMap])

  const pct = s.skinTotal ? (s.skinOwned / s.skinTotal) * 100 : 0
  const R = 44
  const C = 2 * Math.PI * R

  // 生成默认方案名：2026-11-20 方案N（按当天已有数量递增）
  const makeDefaultPlanName = async () => {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    let n = 1
    try {
      const r = await window.lol.listPlans()
      const list = (r && r.ok && r.data.plans) || []
      n = list.filter((p) => String(p.name || '').startsWith(day)).length + 1
    } catch {
      /* 忽略 */
    }
    return day + ' 方案' + n
  }
  /* 图片：粘贴 / 选文件 */
  // 图片识别已移除：直接提示手动输入
  const handleImage = () => {
    setImgNote('已不再支持图片识别，请直接输入皮肤名，或粘贴方案分享码')
  }

  // 粘贴交给默认行为（支持文本/分享码）

  // 点 ↑：先解析出皮肤，进入确认阶段
  const send = async (overrideText) => {
    const raw = typeof overrideText === 'string' ? overrideText : text || ''
    if (!raw.trim()) return
    setParsing(true)
    try {
      // 先判断是不是方案分享码（咕咕...嘎嘎）
      if (/咕咕[\s\S]{2,400}嘎嘎/.test(raw)) {
        const ir = await window.lol.importPlan({ code: raw })
        if (!ir || !ir.ok) {
          setImgNote((ir && ir.error) || '分享码解析失败')
          return
        }
        const ids = (ir.data.plan && ir.data.plan.skinIds) || []
        if (!ids.length) {
          setImgNote('分享码里没有皮肤')
          return
        }

        // 从藏品里建索引（字段与 skinParse 的 item 保持一致，弹窗才能正常读）
        const byId = new Map()
        for (const c of (collection && collection.champions) || []) {
          for (const sk of c.skins || []) {
            if (sk.isBase) continue
            byId.set(sk.id, {
              skinId: sk.id,
              skinName: sk.name,
              championId: c.id,
              championName: c.name,
              rarity: sk.rarity,
              rarityLabel: sk.rarityLabel,
              tilePath: sk.tilePath,
              splashPath: sk.splashPath,
              releaseLabel: sk.releaseLabel,
              releaseAt: sk.releaseAt,
              owned: !!sk.owned,
            })
          }
        }

        const items = ids.map((id) => byId.get(id)).filter(Boolean)
        if (!items.length) {
          setImgNote('分享码解出 ' + ids.length + ' 款，但藏品里没找到（可能客户端未连接）')
          return
        }
        setMatchItems(items)
        setSelectedIds(new Set(items.map((x) => x.skinId)))
        setPlanName(await makeDefaultPlanName())
        setExpiresAt(ir.data.plan.expiresAt || '')
        setModalStage('confirm')
        return
      }

      const r = await window.lol.skinParse({ text: raw })
      if (!r || !r.ok) {
        setImgNote((r && r.error) || '解析失败')
        return
      }
      const items = r.data.items || []
      if (!items.length) {
        setImgNote('一个皮肤都没匹配上，检查下名字写法')
        return
      }
      setMatchItems(items)
      setSelectedIds(new Set(items.map((x) => x.skinId)))
      setPlanName(await makeDefaultPlanName())
      setExpiresAt((r.data && r.data.expiresAt) || '')
      setModalStage('confirm')
      // 预加载全量皮肤库供搜索（有缓存，很快）
      if (!allSkins && window.lol.storeItems) {
        window.lol.storeItems({ view: 'all' }).then((rr) => {
          if (rr && rr.ok) setAllSkins(rr.data.items || [])
        })
      }
    } catch (e) {
      setImgNote('解析失败：' + (e && e.message ? e.message : String(e)))
    } finally {
      setParsing(false)
    }
  }

  // 确认后正式分析
  const confirmGo = async () => {
    const names = matchItems.filter((x) => selectedIds.has(x.skinId)).map((x) => x.skinName)
    if (!names.length) return
    setModalStage('result')
    await onAnalyze(names.join('\n'), planName)
  }
  confirmRef.current = confirmGo

  const toggleSel = (id) => {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // 搜索结果（可加入待选）
  const searchHits = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    if (!q || !allSkins) return []
    const inList = new Set(matchItems.map((x) => x.skinId))
    return allSkins
      .filter((x) => !inList.has(x.skinId))
      .filter((x) => x.name.toLowerCase().includes(q) || String(x.championName || '').toLowerCase().includes(q))
      .slice(0, 12)
  }, [searchQ, allSkins, matchItems])

  const addSearchHit = (x) => {
    setMatchItems((prev) => [...prev, { skinId: x.skinId, skinName: x.name, championName: x.championName, tilePath: x.tilePath, rarity: x.rarity, rarityLabel: x.rarityLabel }])
    setSelectedIds((prev) => new Set(prev).add(x.skinId))
    setSearchQ('')
  }

  if (!collection) {
    return <NotConnected status={status} onRefresh={onRefresh} onElevate={onElevate} hint="连接客户端后，这里会显示你的收藏完成度、稀有度分布、常玩英雄和皮肤分析" />
  }

  return (
    <div className="ov-page">
      {/* ── 上 62%：左总览 + 右常玩 ── */}
      <div className="ov-top">
        <section className="card ov-left">
          <div className="ov-head">
            {/* 圆环在左上 */}
            <div className="ov-ring-wrap">
              <svg className="ov-ring" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r={R} className="ov-ring-bg" />
                <circle
                  cx="50"
                  cy="50"
                  r={R}
                  className="ov-ring-fg"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - Math.min(1, pct / 100))}
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div className="ov-ring-text">
                <div className="ov-ring-num">{s.skinOwned}</div>
                <div className="ov-ring-total">/ {s.skinTotal}</div>
                <div className="ov-ring-pct">{pct.toFixed(1)}%</div>
              </div>
            </div>

            {/* 稀有度徽章：一行多个 */}
            <div className="ov-gems">
              {gemStats.map((g) => (
                <span
                  key={g.key}
                  className={'gem-chip g-' + g.key}
                  title={`${g.label}：拥有 ${g.owned} / 共 ${g.total}`}
                >
                  {g.label}
                  <b>{g.owned}</b>
                  <em>/{g.total}</em>
                </span>
              ))}
            </div>
          </div>

          <div className="ov-sec">
            <div className="ov-sec-head">
              <span>零皮肤英雄</span>
              <b>{zeroSkin.length}</b>
            </div>
            <ChampIconRow list={zeroSkin} tierMap={tierMap} />
          </div>

          <div className="ov-sec">
            <div className="ov-sec-head">
              <span>无史诗及以上皮肤</span>
              <b>{noEpic.length}</b>
            </div>
            <ChampIconRow list={noEpic} tierMap={tierMap} />
          </div>

          <div className="ov-sec">
            <div className="ov-sec-head">
              <span>无传说及以上皮肤</span>
              <b>{noLegend.length}</b>
            </div>
            <ChampIconRow list={noLegend} tierMap={tierMap} />
          </div>
        </section>

        <section className="card ov-right">
          <h3 className="ov-right-title">常玩英雄</h3>
          <div className="fav-list">
            {favs.map((f) => (
              <FavCard
                key={f.champ.id}
                champ={f.champ}
                tier={f.tier}
                lv={f.lv}
                ownedSkins={f.ownedSk}
                missingSkins={f.missSk}
                total={f.total}
                priceMap={priceMap}
              />
            ))}
            {!favs.length ? <div className="dim small">还没有英雄成就数据</div> : null}
          </div>
        </section>
      </div>

      {/* ── 下 38%：皮肤分析 ── */}
      <section className="card ov-bottom">
        <div className="ds-box">
          <textarea
            className="ds-textarea"
            placeholder={PLACEHOLDER}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
          />

          {imgNote ? <div className="ds-note">{imgNote}</div> : null}

          <div className="ds-actions">
            <button className="ds-plus" title="图片识别已移除，请直接输入皮肤名" onClick={handleImage}>
              <IconImage size={16} />
            </button>
            <div className="spacer" />
            <button className="ds-send" disabled={!text.trim() || analyzeBusy} onClick={() => send()} title="开始比较">
              {analyzeBusy ? <span className="spin" /> : <IconArrowUp size={17} />}
            </button>
          </div>
        </div>

        {/* 弹窗承载确认与结果，这里不再内嵌 */}
      </section>

      {modalStage ? (
        <AnalysisModal
          stage={modalStage}
          matchItems={matchItems}
          selectedIds={selectedIds}
          onToggle={toggleSel}
          onAddSkin={addSearchHit}
          allSkins={allSkins}
          analysis={analysis}
          picked={picked}
          onTogglePick={onTogglePick}
          onConfirm={confirmGo}
          busy={analyzeBusy}
          ctxMap={ctxMap}
          planId={analysisPlanId}
          onOpenSkins={onOpenSkins}
          planName={planName}
          setPlanName={setPlanName}
          expiresAt={expiresAt}
          setExpiresAt={setExpiresAt}
          onClose={() => setModalStage(null)}
        />
      ) : null}
    </div>
  )
}
