'use strict'
const { app, BrowserWindow, ipcMain, protocol, shell } = require('electron')
const path = require('node:path')

// 数据层统一走 core（与 CLI / skill 共用同一份实现，不再有第二套代码）
const core = require('../core')
const connection = core.connection
const catalog = core.catalog
const store = require('../core/lcu/store')

const DEV_URL = process.env.VITE_DEV_URL || ''
const isDev = !!DEV_URL

/** lcu:// 自定义协议：把客户端内置资源（皮肤贴图/头像）代理给前端，离线可用 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lcu',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
  },
])

let win = null

/** 藏品缓存由 core 统一管理，桌面端只做一层薄封装 */
async function getCollectionCached(_conn, { force = false } = {}) {
  return core.getCollection({ force })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0a0e14',
    frame: false,
    show: false,
    autoHideMenuBar: true,
    title: 'LOL 皮肤决策助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  if (isDev) {
    win.loadURL(DEV_URL)
  } else {
    // INIT_TAB/INIT_VIEW/INIT_POP 仅用于调试/截图，正常启动不传
    const q = {}
    if (process.env.INIT_TAB) q.tab = process.env.INIT_TAB
    if (process.env.INIT_VIEW) q.view = process.env.INIT_VIEW
    if (process.env.INIT_POP) q.pop = process.env.INIT_POP
    if (process.env.INIT_GROUP) q.group = process.env.INIT_GROUP
    if (process.env.INIT_DEMO) q.demo = process.env.INIT_DEMO

    // 用 loadURL + 时间戳参数强制重读：file:// 协议下 clearCache() 不管用，
    // 否则 dist 换了 JS 的 hash，Electron 仍会加载已删除的旧文件
    const idxPath = path.join(__dirname, '..', 'dist', 'index.html')
    const { pathToFileURL } = require('node:url')
    const u = new URL(pathToFileURL(idxPath).href)
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
    u.searchParams.set('_v', String(Date.now()))
    win.webContents.session.clearCache().catch(() => {}).finally(() => win.loadURL(u.href))
  }

  // 外部链接走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    win = null
  })

  // 调试：SHOT_PATH 指定时，加载完成后自动截一张窗口图（不影响正常使用）
  if (process.env.SHOT_PATH) {
    win.webContents.once('did-finish-load', () => {
      const delay = Number(process.env.SHOT_DELAY || 2200)
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage()
          require('node:fs').writeFileSync(process.env.SHOT_PATH, img.toPNG())
          console.log('[shot]', process.env.SHOT_PATH)
        } catch (e) {
          console.error('[shot-fail]', e.message)
        }
      }, delay)
    })
  }
}

/** IPC 统一包装：永不抛，统一 {ok, data|error} */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_evt, ...args) => {
    try {
      const data = await fn(...args)
      return { ok: true, data }
    } catch (e) {
      return {
        ok: false,
        error: (e && e.message) || String(e),
        code: (e && e.code) || 'ERROR',
        status: (e && e.status) || 0,
      }
    }
  })
}

function registerIpc() {
  handle('app:info', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    userData: app.getPath('userData'),
    dev: isDev,
  }))

  /** 取全部皮肤 ID（分享编码建索引用） */
  async function allSkinIds() {
    const col = await core.getCollection()
    const out = []
    for (const ch of col.champions || []) {
      for (const sk of ch.skins || []) if (!sk.isBase) out.push(sk.id)
    }
    return out
  }

  handle('lcu:status', async (force) => {
    const conn = await connection.discover({ force: !!force })
    if (!conn) {
      // 区分「没开客户端」和「权限不够读不到凭据」
      const diag = connection.diagnose()
      return {
        connected: false,
        reason: diag.reason,
        needsElevation: diag.needsElevation,
        clientRunning: diag.clientRunning,
        lockfile: diag.lockfile,
      }
    }
    const s = conn.summoner || {}
    return {
      connected: true,
      port: conn.port,
      source: conn.source,
      summoner: {
        summonerId: s.summonerId,
        puuid: s.puuid,
        gameName: s.gameName || s.displayName || '',
        tagLine: s.tagLine || '',
        level: s.summonerLevel,
        profileIconId: s.profileIconId,
      },
    }
  })

  handle('usage:load', async (force) => {
    return core.getUsage({ force: !!force })
  })

  handle('app:relaunchElevated', async () => {
    const { execFile } = require('node:child_process')
    const fsx = require('node:fs')
    const exe = process.execPath
    // 关键：提权进程的工作目录会变成 System32，必须给绝对路径，否则新实例找不到 app 直接退出
    const appPath = app.getAppPath()
    // 开发态 appPath 是项目目录；打包后是 app.asar，工作目录要取它所在目录
    let workdir = appPath
    try {
      if (!fsx.statSync(appPath).isDirectory()) workdir = path.dirname(appPath)
    } catch {
      workdir = path.dirname(appPath)
    }
    const logPath = path.join(app.getPath('userData'), 'relaunch.log')
    const cmd =
      `Start-Process -FilePath "${exe}" -ArgumentList '"${appPath}"' ` +
      `-WorkingDirectory "${workdir}" -Verb RunAs`
    try {
      fsx.appendFileSync(logPath, `\n[${new Date().toISOString()}] ${cmd}\n`)
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd],
        { windowsHide: true, timeout: 20000 },
        (err, out, errOut) => {
          try {
            fsx.appendFileSync(
              logPath,
              `  err=${(err && err.message) || 'none'} stderr=${(errOut || '').trim()}\n`
            )
          } catch {
            /* ignore */
          }
        }
      )
    } catch (e) {
      return { ok: false, error: e.message }
    }
    // 不自动退出：万一提权被取消，当前实例仍然可用
    return { ok: true, cmd, log: logPath }
  })

  handle('lcu:collection', async (force) => {
    const conn = await connection.discover({ force: !!force })
    if (!conn) throw Object.assign(new Error('客户端未连接'), { code: 'NO_CLIENT' })
    return getCollectionCached(conn, { force: !!force })
  })

  handle('catalog:load', async (force) => {
    const conn = await connection.discover()
    const data = await catalog.load(conn, { force: !!force })
    return {
      source: data.source,
      skinCount: data.skinCount,
      championCount: data.championCount,
      fetchedAt: data.fetchedAt,
    }
  })

  handle('catalog:clear', async () => {
    catalog.clear()
    return true
  })

  handle('store:probe', async () => {
    const conn = await connection.discover()
    if (!conn) throw Object.assign(new Error('客户端未连接'), { code: 'NO_CLIENT' })
    return store.probe(conn)
  })

  handle('store:prices', async (skinIds) => {
    const conn = await connection.discover()
    if (!conn) throw Object.assign(new Error('客户端未连接'), { code: 'NO_CLIENT' })
    const [prices, sales] = await Promise.all([
      store.fetchPrices(conn, { skinIds: skinIds || null }),
      store.fetchSales(conn),
    ])
    // 折扣批次补进价格表（有的区服 catalog 不带 sale 字段）
    const saleMap = new Map(sales.map((s) => [s.skinId, s]))
    for (const [id, p] of Object.entries(prices)) {
      const s = saleMap.get(Number(id))
      if (s && s.saleRp && p.rp && s.saleRp < p.rp) {
        p.originalRp = p.rp
        p.rp = s.saleRp
        p.discountPct = Math.round((1 - p.rp / p.originalRp) * 100)
        p.onSale = true
        p.saleEnd = s.endDate
      }
    }
    return { prices, sales, fetchedAt: Date.now() }
  })

  handle('store:items', async (opts) => core.getStoreItems(opts || {}))
  handle('store:mythic', async (opts) => core.getMythicShop(opts || {}))
  handle('stats:champions', async (opts) => core.getChampionStats(opts || {}))
  handle('plans:share', async (id) => {
    const all = await allSkinIds()
    return core.plans.sharePlan(id, all)
  })
  handle('plans:import', async (payload) => {
    const all = await allSkinIds()
    return core.plans.importPlan((payload && payload.code) || '', (payload && payload.name) || '', all)
  })

  handle('plans:list', async () => ({ plans: await core.listPlans() }))
  handle('plans:save', async (payload) => core.savePlan(payload || {}))
  handle('plans:delete', async (id) => core.deletePlan(id))

  // 无边框窗口的自绘按钮
  // 复制到剪贴板：走主进程的 clipboard，比渲染进程的 navigator.clipboard 可靠
  handle('app:copyText', async (text) => {
    try {
      const { clipboard } = require('electron')
      clipboard.writeText(String(text || ''))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  handle('app:openExternal', async (url) => {
    if (typeof url === 'string' && /^https?:/i.test(url)) {
      await shell.openExternal(url)
      return { ok: true }
    }
    return { ok: false, error: '只允许 http/https' }
  })

  handle('win:minimize', async () => (win ? win.minimize() : null))
  handle('win:toggleMaximize', async () => {
    if (!win) return null
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  handle('win:close', async () => (win ? win.close() : null))

  handle('analyze', async (payload) => {
    const conn = await connection.discover()
    if (!conn) throw Object.assign(new Error('客户端未连接'), { code: 'NO_CLIENT' })
    const text = (payload && payload.text) || ''
    const prices = (payload && payload.prices) || {}
    const [usg, result] = await Promise.all([
      core.getUsage().catch(() => null),
      core.analyze(text, {
        prices,
        withPrices: !prices || !Object.keys(prices).length,
        withUsage: false,
        refresh: !!(payload && payload.refresh),
      }),
    ])
    return {
      ...result,
      stats: (await core.getCollection()).stats,
      summoner: (await core.getCollection()).summoner,
      usage: usg ? { ...usg, byChampion: undefined } : null,
    }
  })

  // 预览用：只解析不采集（未连接也能试）
  handle('skin:parse', async (payload) => {
    const col = await core.getCollection()
    const cat = await catalog.load(null)
    const text = (payload && payload.text) || ''
    const r = core.analyzer.analyze(text, col, cat, {})
    const all = []
    const seen = new Set()
    for (const k of ['S', 'A', 'B', 'C', 'D', 'skip']) {
      for (const it of r.groups[k] || []) {
        if (seen.has(it.skinId)) continue
        seen.add(it.skinId)
        all.push(it)
      }
    }
    // 补：从原文里再提取一遍皮肤名（解决「一行里写了多个皮肤」）
    const extra = core.analyzer.extractSkinNames(text, cat)
    for (const sk of extra) {
      if (seen.has(sk.id)) continue
      seen.add(sk.id)
      const champ = col.champions.find((c) => c.id === sk.championId)
      all.push({
        skinId: sk.id,
        skinName: sk.name,
        championId: sk.championId,
        championName: (champ && champ.name) || sk.championName || '',
        rarity: sk.rarity,
        rarityLabel: sk.rarityLabel,
        tilePath: sk.tilePath,
      })
    }
    const { extractDeadline } = require('../core/dateextract')
    return { items: all, summary: { ...r.summary, matched: all.length }, expiresAt: extractDeadline(text) }
  })

}

// 单实例锁：重复启动只聚焦已有窗口，避免开出多个「皮肤决策助手」
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  // 绿色版：数据目录放在 exe 同级（整个文件夹可拷走，skill 也能直接读 <解压目录>\userdata）
  // 开发态仍用 %APPDATA%，避免污染
  if (app.isPackaged) {
    const portableDir = path.join(path.dirname(app.getPath('exe')), 'userdata')
    try {
      require('node:fs').mkdirSync(portableDir, { recursive: true })
      app.setPath('userData', portableDir)
    } catch (e) {
      // 放在只读目录时退回默认（%APPDATA%）
      console.warn('[portable] 无法创建 userdata，使用默认路径:', e.message)
    }
  }

  app.whenReady().then(() => {
    // 桌面端缓存落在 userData，与 CLI 共用同一份（CLI 也指向这里）
    core.configure({ cacheDir: path.join(app.getPath('userData'), 'cache') })
    core.plansConfigure(path.join(app.getPath('userData')))

    // 臻彩清单：12 小时过期，过期就后台抓一次（不阻塞窗口）
    // 上线时间补全：客户端开着时，后台用 B 站演示视频日期补齐缺失项（每次最多 20 个）
    const releaseDb = require('../core/release')
    releaseDb
      .fillMissingFromBili({ limit: 20 })
      .then((r) => r && r.filled && console.log('[release] B 站补全', r.filled, '条'))
      .catch(() => {})

    const prestige = require('../core/prestige')
    prestige
      .ensureFresh()
      .then((r) => r && r.ok && !r.skipped && console.log('[prestige] 已更新', r.count, '条'))
      .catch(() => {})

    // 资源代理
    protocol.handle('lcu', async (request) => {
      try {
        const u = new URL(request.url)
        const apiPath = '/' + u.hostname + decodeURIComponent(u.pathname)
        const conn = await connection.discover()
        if (!conn) return new Response('no client', { status: 503 })
        const { lcuBinary } = require('../core/lcu/api')
        const r = await lcuBinary(conn, apiPath)
        if (!r.status || !r.buffer) return new Response('not found', { status: 404 })
        return new Response(r.buffer, {
          status: 200,
          headers: {
            'content-type': r.contentType,
            'cache-control': 'public, max-age=86400',
          },
        })
      } catch {
        return new Response('error', { status: 500 })
      }
    })

    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e)
})
process.on('unhandledRejection', (e) => {
  console.error('[unhandled]', e)
})
