import { useEffect, useMemo, useState } from 'react'
import { fmtRp, rarityClass } from '../lib.js'
import { scoreOf, buildCtxMap } from '../lib/score.js'
import Thumb from '../components/Thumb.jsx'
import SkinCard from '../components/SkinCard.jsx'
import SkinMiniCard from '../components/SkinMiniCard.jsx'
import {
  buildChampInfoMap,
  buildChromaMap,
  buildStoreItemMap,
  loadStoreItems,
  toSkinCardSkin,
} from '../lib/skinCardData.js'
import ScorePopover from '../components/ScorePopover.jsx'
import {
  IconCheck,
  IconTrash,
  IconShare,
  IconDownload,
  IconPlus,
  IconSearch,
  IconList,
  IconX,
} from '../components/Icon.jsx'

/** 方案里的皮肤：统一用「皮肤卡片」，一行 3 个（见 DESIGN.md） */
function SkinGrid({ skins, champInfoMap, chromaMap, ctxMap, onScore }) {
  if (!skins.length) {
    return <div className="plan-empty-skins">这个方案的皮肤在藏品里没找到（客户端可能未连接）</div>
  }
  return (
    <div className="plan-skin-grid">
      {skins.map((s) => {
        const cm = chromaMap && chromaMap[s.id]
        const ci = champInfoMap && champInfoMap[s.championId]
        return (
          <SkinCard
            key={s.id}
            skin={s}
            champInfo={ci}
            chromaInfo={cm || (ctxMap && ctxMap.byChroma && ctxMap.byChroma[s.id]) || {}}
            ctxMap={ctxMap}
            onOpenChamp={() => {}}
            onScore={onScore}
          />
        )
      })}
    </div>
  )
}

/** 方案推荐值详情：按总分排序的表格 */
function PlanDetail({ plan, skins, ctxMap, onClose }) {
  const rows = skins
    .map((s) => {
      const cm = (ctxMap && ctxMap.byChroma && ctxMap.byChroma[s.id]) || {}
      const ci = (ctxMap && ctxMap.byChamp && ctxMap.byChamp[s.championId]) || {}
      const sc = scoreOf(
        { ...s, price: { originalRp: s.originalRp != null ? s.originalRp : (s.price && s.price.originalRp) || 0 } },
        {
          ownedByRarity: (ctxMap && ctxMap.byRarity && ctxMap.byRarity[s.championId]) || {},
          chromaOwned: cm.chromaOwned || 0,
          prestigeOwned: cm.prestigeOwned || 0,
          champSkinOwned: ci.skinOwned || 0,
          masteryLevel: ci.masteryLevel || 0,
        }
      )
      return { s, sc }
    })
    .sort((a, b) => b.sc.total - a.sc.total)

  const get = (sc, k) => {
    const p = sc.parts.find((x) => x.key === k)
    return p ? Math.round(p.val) : 0
  }

  return (
    <div className="pd-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pd-panel" onClick={(e) => e.stopPropagation()}>
        <div className="pd-head">
          <b>{plan.name} · 推荐值详情</b>
          <span className="dim small">共 {skins.length} 款</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            <IconX size={14} />
          </button>
        </div>
        <div className="pd-body">
          <table className="pd-table">
            <thead>
              <tr>
                <th>#</th>
                <th>皮肤</th>
                <th>英雄</th>
                <th>等级</th>
                <th className="num">稀有度</th>
                <th className="num">售价</th>
                <th className="num">限定</th>
                <th className="num">臻彩</th>
                <th className="num">炫彩</th>
                <th className="num">零皮肤</th>
                <th className="num">荣耀</th>
                <th className="num">新鲜</th>
                <th className="num total">总分</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, sc }, i) => (
                <tr key={s.id}>
                  <td className="dim">{i + 1}</td>
                  <td className="pd-skin-name">{s.name}</td>
                  <td className="dim">{s.championName}</td>
                  <td className={'rb ' + rarityClass(s.rarity)}>{s.rarityLabel}</td>
                  <td className="num">{get(sc, '稀有度')}</td>
                  <td className="num">{get(sc, '售价')}</td>
                  <td className="num">{get(sc, '限定') || '—'}</td>
                  <td className="num">{get(sc, '臻彩') || '—'}</td>
                  <td className="num">{get(sc, '炫彩') || '—'}</td>
                  <td className="num">{get(sc, '零皮肤') || '—'}</td>
                  <td className="num">{get(sc, '荣耀') || '—'}</td>
                  <td className="num">{get(sc, '新鲜度') || '—'}</td>
                  <td className="num total">{sc.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function PlanPage({ collection, usage, stats, connected, onOpenSkins, visible }) {
  const [plans, setPlans] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importCode, setImportCode] = useState('')
  const [editingName, setEditingName] = useState(null)
  const [expireDraft, setExpireDraft] = useState(null) // null=关闭，字符串=正在编辑
  const [detailOpen, setDetailOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null) // 待确认删除的方案
  const [scoreTarget, setScoreTarget] = useState(null) // 正在看推荐值明细的皮肤
  const [storeData, setStoreData] = useState(null)
  const [storeLoading, setStoreLoading] = useState(false)
  const [storeError, setStoreError] = useState(null)

  // 与皮肤页共用同一份商城快照；皮肤页先打开时这里直接命中缓存
  useEffect(() => {
    if (visible === false || !connected) return
    let alive = true
    setStoreLoading(true)
    loadStoreItems().then((r) => {
      if (!alive) return
      if (r.ok) setStoreData(r.data)
      else setStoreError(r.error)
      setStoreLoading(false)
    })
    return () => {
      alive = false
    }
  }, [visible, connected])

  const load = async () => {
    const r = await window.lol.listPlans()
    if (r && r.ok) {
      const list = r.data.plans || []
      setPlans(list)
      if (!activeId && list.length) setActiveId(list[0].id)
    }
  }
  // 每次切到方案页都重新拉一次（客户端可能刚连上，或方案在别处改过）
  useEffect(() => {
    if (visible === false) return
    load()
  }, [visible, collection])

  // 皮肤索引（藏品 + 商城信息）
  const skinMap = useMemo(() => {
    const m = new Map()
    for (const c of (collection && collection.champions) || []) {
      for (const s of c.skins || []) {
        if (s.isBase) continue
        m.set(s.id, { ...s, name: s.name, championId: c.id, championName: c.name })
      }
    }
    return m
  }, [collection])

  const ctxMap = useMemo(() => buildCtxMap(collection, usage, stats), [collection, usage, stats])
  const champInfoMap = useMemo(
    () => buildChampInfoMap(collection, usage, stats),
    [collection, usage, stats]
  )
  const chromaMap = useMemo(() => buildChromaMap(collection), [collection])
  const storeItemMap = useMemo(() => buildStoreItemMap(storeData), [storeData])
  const active = plans.find((p) => p.id === activeId) || null
  const activeSkins = useMemo(() => {
    if (!active) return []
    return (active.skinIds || [])
      .map((id) => toSkinCardSkin(skinMap.get(id), storeItemMap.get(id)))
      .filter(Boolean)
  }, [active, skinMap, storeItemMap])

  const totalRp = activeSkins.reduce((s, x) => s + (x.rp != null ? x.rp : (x.price && x.price.rp) || 0), 0)

  /** 左栏直接分享（不用先选中） */
  const shareById = async (id, name) => {
    const r = await window.lol.sharePlan(id)
    if (!r || !r.ok || !r.data) {
      setMsg((r && r.error) || '生成口令失败')
      setTimeout(() => setMsg(''), 4000)
      return
    }
    const exp = r.data.expiresAt ? ' 到期' + r.data.expiresAt : ''
    const full = '【' + (name || '方案') + '】口令 ' + r.data.code + exp
    const cp = await window.lol.copyText(full)
    setMsg(cp && cp.ok ? '已复制：' + full : '复制失败')
    setTimeout(() => setMsg(''), 6000)
  }

  const doShare = async () => {
    if (!active) return
    const r = await window.lol.sharePlan(active.id)
    if (!r || !r.ok || !r.data) {
      setMsg((r && r.error) || '生成口令失败')
      setTimeout(() => setMsg(''), 4000)
      return
    }
    // 完整口令：【方案名】口令 咕咕…嘎嘎
    const exp2 = r.data.expiresAt ? ' 到期' + r.data.expiresAt : ''
    const full = '【' + active.name + '】口令 ' + r.data.code + exp2
    const cp = await window.lol.copyText(full)
    if (cp && cp.ok) {
      setMsg(`已复制：${full}`)
    } else {
      setMsg('复制失败：' + ((cp && cp.error) || '未知错误'))
    }
    setTimeout(() => setMsg(''), 6000)
  }

  const doImport = async () => {
    if (!importCode.trim()) return
    setBusy(true)
    try {
      const r = await window.lol.importPlan({ code: importCode.trim() })
      if (r && r.ok) {
        setMsg('导入成功：' + (r.data.plan.skinIds || []).length + ' 款')
        setImportCode('')
        setImportOpen(false)
        await load()
      } else {
        setMsg((r && r.error) || '导入失败')
      }
      setTimeout(() => setMsg(''), 4000)
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async (plan) => {
    const target = plan || active
    if (!target) return
    await window.lol.deletePlan(target.id)
    setConfirmDel(null)
    await load()
    // 删掉的是当前选中项时，自动选中剩下的第一个，避免右侧空白
    if (activeId === target.id) {
      const rest = plans.filter((x) => x.id !== target.id)
      setActiveId(rest.length ? rest[0].id : null)
    }
  }

  const doRename = async (name) => {
    if (!active || !name.trim()) {
      setEditingName(null)
      return
    }
    await window.lol.savePlan({ id: active.id, name: name.trim() })
    setEditingName(null)
    await load()
  }

  const saveExpire = async () => {
    if (!active) return
    const clean = String(expireDraft || '').trim()
    if (clean && !/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      setMsg('格式不对，应为 2026-12-04 这种')
      setTimeout(() => setMsg(''), 3000)
      return
    }
    await window.lol.savePlan({ id: active.id, expiresAt: clean || null })
    setExpireDraft(null)
    await load()
  }

  const fmtDate = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  return (
    <div className="plan-page">
      {/* 左：方案列表 */}
      <aside className="plan-side">
        <div className="plan-side-head">
          <span className="plan-side-title">方案</span>
          <span className="plan-side-count">{plans.length}</span>
          <div className="spacer" />
          <button className="plan-mini-btn" onClick={() => setImportOpen((v) => !v)} title="导入口令">
            <IconDownload size={13} /> 导入
          </button>
        </div>

        {importOpen ? (
          <div className="plan-import-box">
            <input
              className="input"
              placeholder="粘贴 咕咕…嘎嘎 口令"
              value={importCode}
              onChange={(e) => setImportCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doImport()
              }}
              autoFocus
            />
            <button className="btn primary plan-import-go" onClick={doImport} disabled={busy || !importCode.trim()}>
              导入
            </button>
          </div>
        ) : null}

        <div className="plan-side-list">
          {!plans.length ? (
            <div className="plan-side-empty">
              <div>还没有方案</div>
              <div className="dim small">做一次比较就会自动生成</div>
            </div>
          ) : null}
          {plans.map((p) => (
            <div
              key={p.id}
              className={'plan-item' + (p.id === activeId ? ' on' : '')}
              onClick={() => setActiveId(p.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setActiveId(p.id)
              }}
            >
              <div className="plan-item-name">{p.name}</div>
              <div className="plan-item-meta">
                {p.skinIds.length} 款{p.expiresAt ? ' · 到期 ' + p.expiresAt : ''} · {fmtDate(p.updatedAt || p.createdAt)}
              </div>
              {/* 悬浮操作：直接分享 / 删除，不用先选中 */}
              <div className="plan-item-actions">
                <button
                  className="pia-btn"
                  title="分享口令"
                  onClick={(e) => {
                    e.stopPropagation()
                    shareById(p.id, p.name)
                  }}
                >
                  <IconShare size={12} /> 分享
                </button>
                <button
                  className="pia-btn danger"
                  title="删除方案"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDel(p)
                  }}
                >
                  <IconTrash size={12} /> 删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 右：方案详情 */}
      <section className="plan-main">
        {!active ? (
          <div className="plan-main-empty">
            <div className="plan-main-empty-icon">
              <IconSearch size={34} />
            </div>
            <div>从左边选一个方案查看</div>
          </div>
        ) : (
          <>
            <div className="plan-main-head">
              <div className="plan-main-title-row">
                {editingName != null ? (
                  <input
                    className="input plan-name-input"
                    defaultValue={active.name}
                    autoFocus
                    onBlur={(e) => doRename(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') doRename(e.target.value)
                      if (e.key === 'Escape') setEditingName(null)
                    }}
                  />
                ) : (
                  <h2 className="plan-main-title" onClick={() => setEditingName(active.name)} title="点击改名">
                    {active.name}
                  </h2>
                )}
              </div>
              <div className="plan-main-sub">
                共 <b>{active.skinIds.length}</b> 款皮肤
                <span className="plan-expire">
                  {' '}· 到期 {active.expiresAt || '无'}
                </span>
                {totalRp ? <span> · 合计 {fmtRp(totalRp)} 点券</span> : null}
                <span> · 生成于 {fmtDate(active.createdAt)}</span>
                {active.updatedAt && active.updatedAt !== active.createdAt ? (
                  <span> · 更新于 {fmtDate(active.updatedAt)}</span>
                ) : null}
              </div>

              <div className="plan-main-actions">
                <button className="btn primary" onClick={doShare}>
                  <IconShare size={14} /> 分享口令
                </button>
                <button className="btn" onClick={() => setDetailOpen(true)}>
                  <IconList size={14} /> 查看详情
                </button>
                <button className="btn" onClick={() => setExpireDraft(active.expiresAt || '')}>
                  到期时间
                </button>
                <button className="btn" onClick={() => onOpenSkins && onOpenSkins(active.id)}>
                  <IconCheck size={14} /> 在皮肤列表查看
                </button>
                <button className="btn danger" onClick={() => setConfirmDel(active)}>
                  <IconTrash size={14} /> 删除方案
                </button>
              </div>
            </div>

            {expireDraft !== null ? (
              <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
                <span className="small dim">到期时间</span>
                <input
                  className="input"
                  type="date"
                  style={{ width: 170 }}
                  value={expireDraft}
                  onChange={(e) => setExpireDraft(e.target.value)}
                  autoFocus
                />
                <button className="btn primary" onClick={saveExpire}>
                  保存
                </button>
                <button className="btn ghost" onClick={() => setExpireDraft(null)}>
                  取消
                </button>
              </div>
            ) : null}

            {msg ? <div className="plan-msg">{msg}</div> : null}

            {confirmDel ? (
              <div className="cf-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDel(null) }}>
                <div className="cf-panel" onClick={(e) => e.stopPropagation()}>
                  <div className="cf-icon">
                    <IconTrash size={22} />
                  </div>
                  <div className="cf-title">删除方案</div>
                  <div className="cf-text">
                    确定要删除「<b>{confirmDel.name}</b>」吗？
                    <br />
                    共 {confirmDel.skinIds.length} 款皮肤，删除后无法恢复。
                  </div>
                  <div className="cf-actions">
                    <button className="btn" onClick={() => setConfirmDel(null)}>
                      取消
                    </button>
                    <button className="btn danger" onClick={() => doDelete(confirmDel)}>
                      <IconTrash size={13} /> 确认删除
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {scoreTarget ? (
              <ScorePopover
                skin={scoreTarget}
                ctx={{
                  ownedByRarity: (ctxMap.byRarity[scoreTarget.championId] || {}),
                  chromaOwned: (ctxMap.byChroma[scoreTarget.id] || {}).chromaOwned || 0,
                  prestigeOwned: (ctxMap.byChroma[scoreTarget.id] || {}).prestigeOwned || 0,
                  champSkinOwned: (ctxMap.byChamp[scoreTarget.championId] || {}).skinOwned || 0,
                  masteryLevel: (ctxMap.byChamp[scoreTarget.championId] || {}).masteryLevel || 0,
                }}
                onClose={() => setScoreTarget(null)}
              />
            ) : null}

            {detailOpen ? (
              <PlanDetail
                plan={active}
                skins={activeSkins}
                ctxMap={ctxMap}
                onClose={() => setDetailOpen(false)}
              />
            ) : null}

            <div className="plan-main-body">
              {connected && !storeData ? (
                <div className="plan-empty-skins">
                  {storeError ? '读取商城失败：' + storeError : '正在读取商城数据…'}
                </div>
              ) : (
                <SkinGrid
                  skins={activeSkins}
                  champInfoMap={champInfoMap}
                  chromaMap={chromaMap}
                  ctxMap={ctxMap}
                  onScore={(s) => setScoreTarget(s)}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
