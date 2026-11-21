import { useEffect, useMemo, useState } from 'react'
import { rarityClass, fmtRp } from '../lib.js'
import Thumb from './Thumb.jsx'
import { IconX, IconCheck, IconShare } from './Icon.jsx'

/* ==========================================================================
   评分规则（用户定义）
   ========================================================================== */
const RARITY_PTS = {
  kNoRarity: 2,
  kRare: 6,
  kEpic: 10,
  kLegendary: 18,
  kUltimate: 30,
  kMythic: 100,
  kExalted: 300,
  kTranscendent: 1000,
}

/** 荣耀等级分段计分：0-5 每级 1 分，6-10 每级 2 分，11-20 每级 3 分，21-30 每级 4 分… */
function masteryScore(lv) {
  if (!lv || lv <= 0) return 0
  let s = 0
  s += Math.min(lv, 5) * 1
  if (lv > 5) s += Math.min(lv - 5, 5) * 2
  if (lv > 10) s += Math.min(lv - 10, 10) * 3
  if (lv > 20) s += Math.min(lv - 20, 10) * 4
  if (lv > 30) s += (lv - 30) * 5
  return s
}

/**
 * 新鲜度：≤2015 年 5 分；2016–2020 年 10 分；2021 起每年 +5（2021=15、2022=20…）
 */
function freshnessScore(releaseLabelOrAt) {
  let year = 0
  if (typeof releaseLabelOrAt === 'string') {
    const m = releaseLabelOrAt.match(/^(\d{4})/)
    if (m) year = Number(m[1])
  } else if (typeof releaseLabelOrAt === 'number' && releaseLabelOrAt > 0) {
    year = new Date(releaseLabelOrAt).getFullYear()
  }
  if (!year) return { val: 0, note: '无数据' }
  if (year <= 2015) return { val: 5, note: year + ' 年' }
  if (year <= 2020) return { val: 10, note: year + ' 年' }
  return { val: 15 + (year - 2021) * 5, note: year + ' 年' }
}

/** 完整打分，返回 { total, parts[] } */
function scoreOf(it, ctx) {
  const parts = []

  // ① 稀有度：基础分 − 该英雄所有已拥有皮肤（各按自己档位）的 50%
  //    例：已有 2 个稀有 + 1 个史诗 → 扣 2×6×50% + 1×10×50% = 11
  const base = RARITY_PTS[it.rarity] != null ? RARITY_PTS[it.rarity] : 2
  const ownedByRarity = ctx.ownedByRarity || {}
  let penalty = 0
  const penParts = []
  for (const rk of Object.keys(ownedByRarity)) {
    const cnt = ownedByRarity[rk]
    const pts = RARITY_PTS[rk] != null ? RARITY_PTS[rk] : 2
    const sub = cnt * pts * 0.5
    if (sub) {
      penalty += sub
      penParts.push(`${cnt}×${pts}×50%`)
    }
  }
  parts.push({
    key: '稀有度',
    val: base - penalty,
    note: penalty ? `${base} − (${penParts.join(' + ')}) = ${base - penalty}` : `${base}`,
  })

  // ② 售价：原价每 100 点券 = 1 分
  const price = Math.floor(((it.price && it.price.originalRp) || 0) / 100)
  parts.push({ key: '售价', val: price, note: `${it.originalRp || 0} ÷ 100` })

  // ③ 限定
  parts.push({ key: '限定', val: it.legacy ? 20 : 0, note: it.legacy ? '+20' : '—' })

  // ④ 臻彩：每个 +100
  const pre = (ctx.prestigeOwned || 0) * 100
  parts.push({ key: '臻彩', val: pre, note: `${ctx.prestigeOwned || 0} × 100` })

  // ⑤ 炫彩：每个 +10
  const chr = (ctx.chromaOwned || 0) * 10
  parts.push({ key: '炫彩', val: chr, note: `${ctx.chromaOwned || 0} × 10` })

  // ⑥ 该英雄一件皮肤都没有：+100
  const empty = ctx.champSkinOwned === 0 ? 100 : 0
  parts.push({ key: '零皮肤', val: empty, note: empty ? '+100' : '—' })

  // ⑦ 荣耀等级
  const mastery = masteryScore(ctx.masteryLevel)
  parts.push({ key: '荣耀', val: mastery, note: `LV.${ctx.masteryLevel || 0}` })

  // ⑧ 新鲜度：≤2015 年 5 分；2016–2020 年 10 分；2021 起每年 +5
  const fresh = freshnessScore(it.releaseLabel || it.releaseAt)
  parts.push({ key: '新鲜度', val: fresh.val, note: fresh.note })

  const total = parts.reduce((s, p) => s + p.val, 0)
  return { total: Math.round(total), parts }
}

/** 明细行：每行带该项的得分（渲染成行内彩色徽章） */
function detailRows(it, ctx, sc) {
  const get = (key) => {
    const p = sc.parts.find((x) => x.key === key)
    return p ? p.val : 0
  }
  const rows = []
  rows.push({ k: '皮肤等级', v: it.rarityLabel || '普通', score: get('稀有度') })
  rows.push({
    k: '售价',
    v:
      it.price && it.price.rp
        ? `${fmtRp(it.price.rp)}${it.price.discountPct ? ` (−${it.price.discountPct}%)` : ''}`
        : '非点券直购',
    score: get('售价'),
  })
  rows.push({
    k: '原价',
    v: it.price && it.price.originalRp ? fmtRp(it.price.originalRp) : '—',
    score: null,
  })
  rows.push({ k: '上线时间', v: it.releaseLabel ? it.releaseLabel.slice(0, 7) : '未知', score: get('新鲜度') })
  rows.push({ k: '限定', v: it.legacy ? '是' : '否', score: get('限定') })
  rows.push({
    k: '炫彩 / 臻彩',
    v: `${ctx.chromaOwned || 0} / ${ctx.prestigeOwned || 0}`,
    score: get('炫彩') + get('臻彩'),
  })
  rows.push({
    k: '该英雄皮肤',
    v: `${ctx.champSkinOwned || 0} / ${ctx.champSkinTotal || 0}`,
    score: get('零皮肤'),
  })
  rows.push({ k: '荣耀等级', v: ctx.masteryLevel ? `LV.${ctx.masteryLevel}` : '无', score: get('荣耀') })
  rows.push({
    k: '英雄强度',
    v:
      [ctx.tierRanked ? `排位 T${ctx.tierRanked}` : null, ctx.tierAram ? `乱斗 T${ctx.tierAram}` : null]
        .filter(Boolean)
        .join(' · ') || '—',
    score: null,
  })
  return rows
}

/** 公式说明面板 */
function FormulaPanel({ onClose }) {
  return (
    <div className="fx-panel">
      <div className="fx-head">
        <b>推荐值算法</b>
        <div className="spacer" />
        <button className="icon-btn" onClick={onClose}>
          <IconX size={13} />
        </button>
      </div>
      <div className="fx-body">
        <div className="fx-sec">
          <div className="fx-title">① 稀有度基础分</div>
          <div className="fx-line">普通 2 · 稀有 6 · 史诗 10 · 传说 18</div>
          <div className="fx-line">终极 30 · 神话 100 · 卓越 300 · 圣堂 1000</div>
        </div>
        <div className="fx-sec">
          <div className="fx-title">② 同档重复惩罚</div>
          <div className="fx-line">该英雄已有 N 个同档皮肤 → 扣 N × 基础分 × 50%</div>
          <div className="fx-line dim">例：已有 2 个稀有（6 分）→ 扣 6 分</div>
        </div>
        <div className="fx-sec">
          <div className="fx-title">③ 售价</div>
          <div className="fx-line">原价每 100 点券 = 1 分（越贵越高）</div>
        </div>
        <div className="fx-sec">
          <div className="fx-title">④ 限定</div>
          <div className="fx-line">限定皮肤 +20 分</div>
        </div>
        <div className="fx-sec">
          <div className="fx-title">⑤ 炫彩 / 臻彩</div>
          <div className="fx-line">每有 1 个臻彩 +100 分</div>
          <div className="fx-line">每有 1 个炫彩 +10 分</div>
        </div>
        <div className="fx-sec">
          <div className="fx-title">⑥ 零皮肤英雄</div>
          <div className="fx-line">该英雄一件皮肤都没有 → +100 分</div>
        </div>
        <div className="fx-sec">
          <div className="fx-title">⑦ 荣耀等级（分段累加）</div>
          <div className="fx-line">1–5 级：每级 +1</div>
          <div className="fx-line">6–10 级：每级 +2</div>
          <div className="fx-line">11–20 级：每级 +3</div>
          <div className="fx-line">21–30 级：每级 +4</div>
          <div className="fx-line">30 级以上：每级 +5</div>
          <div className="fx-line dim">例：LV.19 = 5×1 + 5×2 + 9×3 = 42 分</div>
        </div>
        <div className="fx-sec">
          <div className="fx-title">⑧ 新鲜度（越新分越高）</div>
          <div className="fx-line">2015 年及以前：+5</div>
          <div className="fx-line">2016–2020 年：+10</div>
          <div className="fx-line">2021 年：+15（2022=20，之后每年 +5）</div>
          <div className="fx-line dim">例：2024 年的皮肤 = 15 + 3×5 = 30 分</div>
        </div>
      </div>
    </div>
  )
}

export default function AnalysisModal({
  stage,
  matchItems,
  selectedIds,
  onToggle,
  onAddSkin,
  allSkins,
  analysis,
  picked,
  onTogglePick,
  onConfirm,
  onClose,
  busy,
  ctxMap,
  planId,
  onOpenSkins,
  planName,
  setPlanName,
  expiresAt,
  setExpiresAt,
}) {
  const [searchQ, setSearchQ] = useState('')
  const [showFormula, setShowFormula] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (showFormula) setShowFormula(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, showFormula])

  const searchHits = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    if (!q || !allSkins) return []
    const inList = new Set(matchItems.map((x) => x.skinId))
    return allSkins
      .filter((x) => !inList.has(x.skinId))
      .filter((x) => x.name.toLowerCase().includes(q) || String(x.championName || '').toLowerCase().includes(q))
      .slice(0, 12)
  }, [searchQ, allSkins, matchItems])

  /** 结果：按总分从高到低 */
  const ranked = useMemo(() => {
    if (!analysis) return []
    const all = []
    for (const tier of ['S', 'A', 'B', 'C', 'D', 'skip']) {
      for (const it of analysis.groups[tier] || []) all.push({ ...it, tier })
    }
    const withScore = all.map((it) => {
      const byChamp = (ctxMap && ctxMap.byChamp) || {}
      const byTier = (ctxMap && ctxMap.byTier) || {}
      const byChroma = (ctxMap && ctxMap.byChroma) || {}
      const byRarity = (ctxMap && ctxMap.byRarity) || {}
      const ci = byChamp[it.championId] || {}
      const cm = byChroma[it.skinId] || {}
      const ti = byTier[it.championId] || {}
      const ctx = {
        champSkinOwned: ci.skinOwned,
        champSkinTotal: ci.skinTotal,
        masteryLevel: ci.masteryLevel,
        ownedByRarity: byRarity[it.championId] || {},
        chromaOwned: cm.chromaOwned || 0,
        prestigeOwned: cm.prestigeOwned || 0,
        tierRanked: ti.ranked,
        tierAram: ti.aram,
      }
      return {
        ...it,
        ctx,
        score: scoreOf(it, ctx),
        details: detailRows(it, ctx, scoreOf(it, ctx)),
        owned: it.tier === 'skip',
        originalRp: (it.price && it.price.originalRp) || 0,
      }
    })
    withScore.sort((a, b) => b.score.total - a.score.total)
    return withScore
  }, [analysis, ctxMap])

  const isConfirm = stage === 'confirm'

  return (
    <div className="an-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'an-panel' + (isConfirm ? '' : ' wide')} onClick={(e) => e.stopPropagation()}>
        <div className="an-head">
          <div className="an-title">
            {isConfirm ? (
              <>
                确认要比对的皮肤
                <span className="an-count">匹配 {matchItems.length} · 已选 {selectedIds.size}</span>
              </>
            ) : (
              <>
                比对结果
                <span className="an-count">共 {ranked.length} 款</span>
                <button
                  className={'an-help' + (showFormula ? ' on' : '')}
                  onClick={() => setShowFormula((v) => !v)}
                  title="查看推荐值算法"
                >
                  ?
                </button>
              </>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭（Esc）">
            <IconX size={14} />
          </button>
        </div>

        {showFormula && !isConfirm ? <FormulaPanel onClose={() => setShowFormula(false)} /> : null}

        {isConfirm ? (
          <>
            <div className="an-plan-name-row">
              <span className="an-plan-name-label">方案名称</span>
              <input
                className="input an-plan-name-input"
                value={planName || ''}
                onChange={(e) => setPlanName && setPlanName(e.target.value)}
                placeholder="给这次比较起个名字"
              />
              <span className="an-plan-name-label">到期时间</span>
              <input
                className="input an-plan-expire-input"
                type="date"
                value={expiresAt || ''}
                onChange={(e) => setExpiresAt && setExpiresAt(e.target.value)}
                placeholder="无"
              />
              {expiresAt ? (
                <button className="an-plan-clear" onClick={() => setExpiresAt('')} title="清除到期时间">
                  清除
                </button>
              ) : null}
            </div>

            <div className="an-search">
              <input
                className="input"
                placeholder="搜索其他皮肤加入（皮肤名 / 英雄名）"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
              {searchHits.length ? (
                <div className="an-hits">
                  {searchHits.map((h) => (
                    <button
                      key={h.skinId}
                      className="hit-row"
                      onClick={() => {
                        onAddSkin(h)
                        setSearchQ('')
                      }}
                    >
                      <Thumb className="hit-thumb" path={h.tilePath} />
                      <span className="hit-name">{h.name}</span>
                      <span className="dim small">{h.championName}</span>
                      <span className="hit-add">+</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="an-grid">
              {matchItems.map((it) => {
                const on = selectedIds.has(it.skinId)
                return (
                  <div key={it.skinId} className={'an-card' + (on ? ' on' : '')} onClick={() => onToggle(it.skinId)}>
                    <Thumb className="an-thumb" path={it.tilePath} />
                    <div className="an-info">
                      <div className="an-name">{it.skinName}</div>
                      <div className="an-meta">
                        <span>{it.championName}</span>
                        {it.rarityLabel ? <span className={'rb ' + rarityClass(it.rarity)}>{it.rarityLabel}</span> : null}
                      </div>
                    </div>
                    <span className="an-check">{on ? <IconCheck size={12} /> : null}</span>
                  </div>
                )
              })}
            </div>

            <div className="an-foot">
              <span className="small dim">点卡片可取消/恢复勾选</span>
              <div className="spacer" />
              <button className="btn" onClick={onClose}>
                取消
              </button>
              <button className="btn primary" disabled={!selectedIds.size || busy} onClick={onConfirm}>
                {busy ? <span className="spin" /> : null} 开始比较
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="cmp-scroll">
              {!analysis ? (
                <div className="empty small dim">正在分析…</div>
              ) : !ranked.length ? (
                <div className="empty small dim">没有可比较的皮肤</div>
              ) : (
                <div className="cmp-table" style={{ '--cols': ranked.length }}>
                  <div className="cmp-row cmp-head-row">
                    <div className="cmp-label-cell" />
                    {ranked.map((it, i) => (
                      <div key={it.skinId} className={'cmp-col-head' + (it.owned ? ' owned' : '')}>
                        <div className="cmp-rank">#{i + 1}</div>
                        <Thumb className="cmp-art" path={it.splashPath || it.tilePath} />
                        <div className="cmp-title" title={it.skinName}>
                          {it.skinName}
                        </div>
                        <div className="cmp-sub">
                          <span>{it.championName}</span>
                          <span className={'rb ' + rarityClass(it.rarity)}>{it.rarityLabel}</span>
                          {it.owned ? <span className="cmp-owned-tag">已拥有</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="cmp-row cmp-score-row">
                    <div className="cmp-label-cell">推荐值</div>
                    {ranked.map((it) => (
                      <div key={it.skinId} className="cmp-cell">
                        <div className="cmp-score">
                          <span className="cmp-score-num">{it.score.total}</span>
                          <span className="cmp-score-max">分</span>
                        </div>
                        <div className="cmp-score-bar">
                          <div
                            className="cmp-score-fill"
                            style={{ width: Math.min(100, (it.score.total / Math.max(1, ranked[0].score.total)) * 100) + '%' }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {ranked[0].details.map((row, ri) => (
                    <div key={ri} className="cmp-row">
                      <div className="cmp-label-cell">{row.k}</div>
                      {ranked.map((it) => {
                        const d = it.details[ri]
                        const sc = d && d.score
                        return (
                          <div key={it.skinId} className="cmp-cell cmp-cell-score">
                            <span>{d ? d.v : '—'}</span>
                            {sc != null && Math.round(sc) !== 0 ? (
                              <span className={'sc-badge ' + (sc > 0 ? 'plus' : 'minus')}>
                                {sc > 0 ? '+' : '−'}{Math.abs(Math.round(sc * 10) / 10)}
                              </span>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ))}

                  <div className="cmp-row cmp-breakdown-row">
                    <div className="cmp-label-cell">推荐值构成</div>
                    {ranked.map((it) => (
                      <div key={it.skinId} className="cmp-cell">
                        <div className="cmp-parts">
                          {it.score.parts.map((p) => (
                            <span key={p.key} className={'cmp-part' + (p.val ? ' on' : '')} title={`${p.key}：${p.note}`}>
                              {p.key} <b>{Math.round(p.val * 10) / 10}</b>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="an-foot">
              <span className="small dim">按推荐值从高到低排列</span>
              <div className="spacer" />
              <button
                className="btn"
                disabled={!planId}
                title={planId ? '复制方案口令' : '方案还没保存好'}
                onClick={async () => {
                  if (!planId) return
                  const r = await window.lol.sharePlan(planId)
                  if (!r || !r.ok || !r.data) {
                    alert((r && r.error) || '生成口令失败')
                    return
                  }
                  const list = await window.lol.listPlans()
                  const p = list && list.ok ? (list.data.plans || []).find((x) => x.id === planId) : null
                  const exp = r.data.expiresAt ? ' 到期' + r.data.expiresAt : ''
                  const full = '【' + (p ? p.name : '方案') + '】口令 ' + r.data.code + exp
                  const cp = await window.lol.copyText(full)
                  alert(cp && cp.ok ? '已复制：' + full : '复制失败')
                }}
              >
                <IconShare size={14} /> 分享口令
              </button>
              <button
                className="btn"
                disabled={!planId}
                onClick={() => {
                  if (!planId) return
                  onClose()
                  if (onOpenSkins) onOpenSkins(planId)
                }}
              >
                <IconCheck size={14} /> 在皮肤列表查看
              </button>
              <button className="btn primary" onClick={onClose}>
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
