import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StorePage from './pages/StorePage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import OverviewPage from './pages/OverviewPage.jsx'
import PlanPage from './pages/PlanPage.jsx'
import { mockApi, mockAnalysis, mockUsage } from './mock.js'
import {
  IconEye,
  IconEyeOff,
  IconRefresh,
  IconSettings,
  IconMinimize,
  IconMaximize,
  IconX,
  IconVideo,
  IconGithub,
  IconDownload,
} from './components/Icon.jsx'

const MOCK = typeof location !== 'undefined' && /[?&]mock=1/.test(location.search)
const INIT_TAB = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('tab')) || 'overview'
// 页面组件里也有直接调用 window.lol 的地方，mock 时必须挂到全局，否则那些调用会落到 undefined
if (MOCK) window.lol = mockApi
const api = MOCK ? mockApi : window.lol

// 分享链接（等用户提供后替换）
const SHARE = {
  bilibili: 'https://space.bilibili.com/',
  github: 'https://github.com/',
  download: 'https://github.com/',
}

const TABS = [
  { key: 'overview', label: '总览' },
  { key: 'skins', label: '皮肤' },
  { key: 'plans', label: '方案' },
]

/** 皮肤页：藏品视图 / 商城视图，同一批数据不同切面 */
function SkinsPage(props) {
  return (
    <div className="skins-page">
      <StorePage
        connected={props.connected}
        status={props.status}
        onRefresh={props.onRefresh}
        onElevate={props.onElevate}
        collection={props.collection}
        usage={props.usage}
        stats={props.stats}
        planFilter={props.planFilter}
        onPlanFilter={props.onPlanFilter}
      />
    </div>
  )
}
export default function App() {
  const [tab, setTab] = useState(TABS.some((x) => x.key === INIT_TAB) ? INIT_TAB : 'overview')
  const [status, setStatus] = useState(null)
  const [collection, setCollection] = useState(null)
  const [catalogInfo, setCatalogInfo] = useState(null)
  const [analysis, setAnalysis] = useState(MOCK ? mockAnalysis : null)
  const [picked, setPicked] = useState(() => new Set(MOCK ? mockAnalysis.groups.S.map((i) => i.skinId) : []))
  const [probe, setProbe] = useState(null)
  const [priceMode, setPriceMode] = useState(true)
  const [info, setInfo] = useState(null)
  const [usageData, setUsageData] = useState(MOCK ? mockUsage : null)
  const [statsData, setStatsData] = useState(null)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState(null)
  const [drawer, setDrawer] = useState(null) // 'settings'
  const [showName, setShowName] = useState(false)
  const [planFilter, setPlanFilter] = useState(null)
  const [analysisPlanId, setAnalysisPlanId] = useState(null)

  const pricesRef = useRef({})
  const toastTimer = useRef(null)

  const notify = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  const refreshCatalog = useCallback(async (force) => {
    const r = await api.catalogLoad(!!force)
    if (r.ok) setCatalogInfo(r.data)
    return r
  }, [])

  const refreshAll = useCallback(
    async (force = false) => {
      setBusy('refresh')
      try {
        const st = await api.status(force)
        if (!st.ok) {
          notify(st.error || '连接失败')
          return
        }
        setStatus(st.data)
        if (!st.data.connected) {
          notify('未检测到客户端，请先启动英雄联盟并登录到大厅')
          return
        }
        const [col, cat] = await Promise.all([api.collection(force), refreshCatalog(false)])
        if (col.ok) {
          setCollection(col.data)
          pricesRef.current = {}
          notify(`已同步 ${col.data.stats.championOwned} 个英雄 / ${col.data.stats.skinOwned} 款皮肤`)
        } else {
          notify(col.error || '读取藏品失败')
        }
        if (cat && !cat.ok) console.warn('catalog', cat.error)
        api.usage(force).then((r) => {
          if (r.ok) setUsageData(r.data)
        })
        api.championStats({ modes: ['ranked', 'aram'] }).then((r) => {
          if (r.ok) setStatsData(r.data)
        })
      } finally {
        setBusy('')
      }
    },
    [notify, refreshCatalog]
  )

  useEffect(() => {
    api.info().then((r) => r.ok && setInfo(r.data))
    refreshAll(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onProbe = useCallback(async () => {
    setBusy('probe')
    try {
      const r = await api.storeProbe()
      if (r.ok) {
        setProbe(r.data)
        notify(r.data.available ? '商城接口可用' : '商城接口无数据，已可关闭价格模块')
      } else {
        notify(r.error || '探测失败')
      }
    } finally {
      setBusy('')
    }
  }, [notify])

  const onAnalyze = useCallback(
    async (text, planName, expiresAt) => {
      setBusy('analyze')
      try {
        let prices = {}
        if (priceMode) {
          if (!Object.keys(pricesRef.current).length) {
            const pr = await api.storePrices(null)
            if (pr.ok) pricesRef.current = pr.data.prices || {}
          }
          prices = pricesRef.current
        }
        const r = await api.analyze({ text, prices })
        if (!r.ok) {
          notify(r.error || '分析失败')
          return null
        }
        setAnalysis(r.data)
        setPicked(new Set(r.data.groups.S.map((i) => i.skinId)))
        // 自动存方案（同一组合复用，只刷新时间）
        try {
          const ids = []
          for (const k of ['S', 'A', 'B', 'C', 'D', 'skip']) {
            for (const it of r.data.groups[k] || []) ids.push(it.skinId)
          }
          if (ids.length) {
            const saved = await api.savePlan({ skinIds: ids, name: planName || undefined, expiresAt: expiresAt || null })
            if (saved && saved.ok && saved.data) setAnalysisPlanId(saved.data.id)
          }
        } catch {
          /* 存方案失败不影响分析结果 */
        }
        return r.data
        if (!r.data.summary.matched) notify('一条都没匹配上，检查下皮肤名写法')
      } finally {
        setBusy('')
      }
    },
    [notify, priceMode]
  )

  const onTogglePick = useCallback((skinId) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(skinId)) next.delete(skinId)
      else next.add(skinId)
      return next
    })
  }, [])

  const onPickAll = useCallback(
    (tiers) => {
      if (!analysis) return
      const ids = tiers.flatMap((t) => (analysis.groups[t] || []).map((i) => i.skinId))
      setPicked(new Set(ids))
    },
    [analysis]
  )

  const connected = !!(status && status.connected)
  const summoner = (collection && collection.summoner) || (status && status.summoner) || {}
  const stats = (collection && collection.stats) || {}

  const tabCounts = useMemo(
    () => ({
      skins: stats.championOwned || null,
      decide: analysis ? analysis.summary.matched : null,
    }),
    [stats, analysis]
  )

  return (
    <div className="app">
      {/* 单行顶部导航：品牌 → 4 个 tab → 状态 → 齿轮 */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">Y</div>
          <div className="brand-text">
            <b>皮肤决策助手</b>
          </div>
        </div>

        <nav className="nav">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={'nav-btn' + (tab === t.key ? ' on' : '')}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {tabCounts[t.key] != null ? <span className="nav-count">{tabCounts[t.key]}</span> : null}
            </button>
          ))}
        </nav>

        <div className="spacer" />

        <div className="statbar">
          <span className={'dot ' + (connected ? 'on' : 'off')} />
          {connected ? (
            <>
              <span className="stat-name">
                {showName ? (
                  <>
                    {summoner.gameName || '已登录'}
                    {summoner.tagLine ? <em>#{summoner.tagLine}</em> : null}
                  </>
                ) : (
                  <span className="name-hidden">●●●●●●</span>
                )}
              </span>
              <button className="icon-btn eye-btn" title={showName ? '隐藏召唤师名' : '显示召唤师名'} onClick={() => setShowName((v) => !v)}>
                {showName ? <IconEye size={14} /> : <IconEyeOff size={14} />}
              </button>
              <span className="stat-sep" />
              <span className="stat">
                英雄 <b>{stats.championOwned ?? '—'}</b>
              </span>
              <span className="stat">
                皮肤 <b>{stats.skinOwned ?? '—'}</b>
              </span>
              <span className="stat-sep" />
              <span className="stat gold">
                <b>{summoner.rp != null ? Number(summoner.rp).toLocaleString('zh-CN') : '—'}</b> 点券
              </span>
              <span className="stat purple">
                <b>{summoner.mythic != null ? Number(summoner.mythic).toLocaleString('zh-CN') : '—'}</b> 精萃
              </span>
            </>
          ) : (
            <span className="stat muted">客户端未连接</span>
          )}
        </div>

        <button className="icon-btn" title="刷新" onClick={() => refreshAll(true)} disabled={busy === 'refresh'}>
          {busy === 'refresh' ? <span className="spin" /> : <IconRefresh size={15} />}
        </button>
        <button className="icon-btn" title="设置" onClick={() => setDrawer('settings')}>
          <IconSettings size={15} />
        </button>
        <div className="win-controls">
          <button className="win-btn" title="最小化" onClick={() => api.winMinimize()}>
            <IconMinimize size={13} />
          </button>
          <button className="win-btn" title="最大化" onClick={() => api.winToggleMaximize()}>
            <IconMaximize size={13} />
          </button>
          <button className="win-btn close" title="关闭" onClick={() => api.winClose()}>
            <IconX size={13} />
          </button>
        </div>
      </header>

      {status && !status.connected && status.needsElevation ? (
        <div className="banner">
          <span>⚠ {status.reason}</span>
          <div className="spacer" />
          <button
            className="btn primary"
            onClick={async () => {
              const r = await api.relaunchElevated()
              if (!r.ok) notify(r.error || '提权重启失败')
            }}
          >
            以管理员身份重启
          </button>
        </div>
      ) : null}

      <main className="main">
        {/* 两个页面常驻挂载，切 tab 只切 display —— 避免来回切换重新拉数据 */}
        <div className="tab-pane" style={{ display: tab === 'overview' ? 'flex' : 'none' }}>
          <OverviewPage
            status={status}
            onRefresh={() => refreshAll(true)}
            onElevate={async () => { const r = await api.relaunchElevated(); if (!r.ok) notify(r.error || '提权重启失败') }}
            collection={collection}
            usage={usageData}
            stats={statsData}
            analysis={analysis}
            analysisPlanId={analysisPlanId}
            onOpenSkins={(pid) => { setPlanFilter(pid); setTab('skins') }}
            picked={picked}
            onAnalyze={onAnalyze}
            onTogglePick={onTogglePick}
            onPickAll={onPickAll}
            analyzeBusy={busy === 'analyze'}
          />
        </div>
        <div className="tab-pane" style={{ display: tab === 'skins' ? 'flex' : 'none' }}>
          <SkinsPage collection={collection} usage={usageData} stats={statsData} connected={connected} status={status} planFilter={planFilter} onPlanFilter={setPlanFilter} onRefresh={() => refreshAll(true)} onElevate={async () => { const r = await api.relaunchElevated(); if (!r.ok) notify(r.error || '提权重启失败') }} />
        </div>
        <div className="tab-pane" style={{ display: tab === 'plans' ? 'flex' : 'none' }}>
          <PlanPage collection={collection} usage={usageData} stats={statsData} connected={connected} visible={tab === 'plans'} onOpenSkins={(planId) => { setPlanFilter(planId); setTab('skins') }} />
        </div>
      </main>

      {drawer === 'settings' ? (
        <div className="drawer-mask" onClick={() => setDrawer(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <b>设置</b>
              <div className="spacer" />
              <button className="icon-btn" onClick={() => setDrawer(null)}>
                <IconX size={14} />
              </button>
            </div>
            <div className="drawer-body">
              <SettingsPage
                info={info}
                catalogInfo={catalogInfo}
                probe={probe}
                priceMode={priceMode}
                setPriceMode={setPriceMode}
                onProbe={onProbe}
                onRefreshCatalog={refreshCatalog}
                onClearCatalog={async () => {
                  await api.catalogClear()
                  pricesRef.current = {}
                  await refreshCatalog(true)
                  notify('缓存已清空')
                }}
                onReconnect={() => refreshAll(true)}
                connected={connected}
                busy={busy}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* 底部：关于与分享链接（占位，等链接提供后替换 href） */}
      <footer className="app-footer">
        <span className="ft-brand">皮肤决策助手</span>
        <span className="ft-sep" />
        <span className="ft-note">本地只读 · 数据来自英雄联盟客户端</span>
        <div className="spacer" />
        <button className="ft-link" onClick={() => api.openExternal(SHARE.bilibili)} title="B 站视频">
          <IconVideo size={14} />
          <span>B 站</span>
        </button>
        <button className="ft-link" onClick={() => api.openExternal(SHARE.github)} title="GitHub 开源">
          <IconGithub size={14} />
          <span>GitHub</span>
        </button>
        <button className="ft-link primary" onClick={() => api.openExternal(SHARE.download)} title="下载最新版">
          <IconDownload size={14} />
          <span>下载</span>
        </button>
        <span className="ft-sep" />
        <span className="ft-ver">v{info && info.version ? info.version : '…'}</span>
      </footer>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
