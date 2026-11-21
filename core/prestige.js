'use strict'
/**
 * 国服臻彩清单（有独立原画的炫彩）
 *
 * 数据源：https://splash.buguoguo.cn/prestigechromas
 *   布锅锅联盟宇宙的 Next.js 站，完整数据内嵌在 __NEXT_DATA__ 的
 *   props.pageProps.allPrestigeChromas（实测 497 条）。
 *   原画托管在腾讯 CDN：game.qtimg.cn/images/lol/act/a20230715chromahub/
 *   开源仓库：https://github.com/BuguoguoLoLCreator/lol-skin-explorer (GPLv3)
 *
 * 为什么需要它：CD 的 skins.json 没有「臻彩」概念，炫彩只有统一预览图。
 *
 * 更新策略：启动时检查本地文件，超过 MAX_AGE 就后台抓一次；失败保留旧数据。
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const SRC = 'https://splash.buguoguo.cn/prestigechromas'
const FILE = path.join(__dirname, '..', 'data', 'prestige-chromas.json')
const MAX_AGE = 12 * 60 * 60 * 1000 // 12 小时

let cache = null
let inflight = null

function readDisk() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (!j || !Array.isArray(j.items)) return null
    return j
  } catch {
    return null
  }
}

function build(raw) {
  const map = new Map()
  for (const it of raw.items || []) map.set(Number(it.chromaId), it)
  return { ...raw, map }
}

function load() {
  if (cache) return cache
  const raw = readDisk()
  cache = raw ? build(raw) : { items: [], map: new Map(), count: 0, fetchedAt: null }
  return cache
}

/** 该炫彩是否是臻彩 */
function isPrestige(chromaId) {
  return load().map.has(Number(chromaId))
}

function get(chromaId) {
  return load().map.get(Number(chromaId)) || null
}

function meta() {
  const c = load()
  return {
    count: c.count || 0,
    fetchedAt: c.fetchedAt || null,
    source: c.source || null,
    sourceUrl: c.sourceUrl || null,
    ageMs: c.fetchedAt ? Date.now() - Date.parse(c.fetchedAt) : null,
  }
}

function httpGet(url, timeout = 40000) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) lol-skin-planner/0.1',
          Accept: 'text/html',
        },
      },
      (res) => {
        const c = []
        res.on('data', (d) => c.push(d))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }))
      }
    )
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, body: '', error: 'timeout' })
    })
    req.end()
  })
}

/** 抓一次并写盘 */
async function fetchNow() {
  const r = await httpGet(SRC)
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status} ${r.error || ''}` }

  const m = r.body.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) return { ok: false, error: '__NEXT_DATA__ 不存在（页面结构可能变了）' }

  let data
  try {
    data = JSON.parse(m[1])
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${e.message}` }
  }

  const list = data && data.props && data.props.pageProps && data.props.pageProps.allPrestigeChromas
  if (!Array.isArray(list) || !list.length) {
    return { ok: false, error: 'allPrestigeChromas 为空（页面结构可能变了）' }
  }

  const items = list
    .filter((x) => x && x.id)
    .map((x) => ({
      chromaId: Number(x.id),
      name: x.name || '',
      splashPath: x.splashPath || '',
      uncenteredSplashPath: x.uncenteredSplashPath || '',
      loadScreenPath: x.loadScreenPath || '',
      tilePath: x.tilePath || '',
      emblemPath: x.emblemPath || '',
    }))
    .sort((a, b) => a.chromaId - b.chromaId)

  const payload = {
    source: 'splash.buguoguo.cn/prestigechromas',
    sourceUrl: SRC,
    origin: '国服臻彩藏馆（原画托管于 game.gtimg.cn/images/lol/act/a20230715chromahub）',
    repo: 'https://github.com/BuguoguoLoLCreator/lol-skin-explorer',
    note: '国服臻彩 = 有独立原画的炫彩，与 Riot 的 rarity 分级无关',
    fetchedAt: new Date().toISOString(),
    count: items.length,
    items,
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(payload, null, 1), 'utf8')
  cache = build(payload)
  return { ok: true, count: items.length, added: 0 }
}

/**
 * 确保数据新鲜：文件缺失或超过 MAX_AGE 才抓，并发去重
 * @param {{force?:boolean, maxAge?:number}} opts
 */
async function ensureFresh(opts = {}) {
  const force = !!opts.force
  const maxAge = opts.maxAge != null ? opts.maxAge : MAX_AGE

  if (!force) {
    const cur = load()
    const age = cur.fetchedAt ? Date.now() - Date.parse(cur.fetchedAt) : Infinity
    if (cur.count > 0 && age < maxAge) {
      return { ok: true, skipped: true, reason: 'cache-fresh', count: cur.count, ageMs: age }
    }
  }

  if (inflight) return inflight
  inflight = fetchNow()
    .catch((e) => ({ ok: false, error: e.message }))
    .finally(() => {
      inflight = null
    })
  return inflight
}

module.exports = { load, isPrestige, get, meta, ensureFresh, fetchNow, FILE, SRC }
