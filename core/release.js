'use strict'
/**
 * 皮肤上线日期（本地数据文件）
 *
 * data/skin-release.json 由 tools/fetch_release.js 生成，来源 Meraki Analytics。
 * 覆盖 1825 款（国服 1967 款里的 92.8%），国服特供/极新皮肤可能缺失。
 *
 * 用途：越新的皮肤通常特效/建模越好，上线时间是「新旧」最直接的客观依据。
 * 在售皮肤优先用 LCU 自己的 releaseDate（更权威），缺失时回退到这里。
 */
const fs = require('node:fs')
const path = require('node:path')

const FILE = path.join(__dirname, '..', 'data', 'skin-release.json')
let cache = null

function load() {
  if (cache) return cache
  let raw = { skins: {} }
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    /* 文件缺失时静默降级 */
  }
  cache = raw
  return cache
}

/** @returns {{release:string, releaseAt:number, name:string}|null} */
function getRelease(skinId) {
  const c = load()
  const s = c.skins && c.skins[Number(skinId)]
  return s || null
}

function meta() {
  const c = load()
  return {
    source: c.source,
    sourceUrl: c.sourceUrl,
    count: c.count,
    fetchedAt: c.fetchedAt,
  }
}

/** 把时间戳/ISO 统一成 "YYYY-MM" */
function monthLabel(v) {
  if (!v) return null
  const ms = typeof v === 'number' ? v : Date.parse(v)
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 算「几年前的皮肤」 */
function ageYears(v) {
  if (!v) return null
  const ms = typeof v === 'number' ? v : Date.parse(v)
  if (!Number.isFinite(ms)) return null
  return Number(((Date.now() - ms) / (365.25 * 86400 * 1000)).toFixed(1))
}



// ---------------------------------------------------------------------------
// B 站补全：缺失的上线时间用「皮肤演示视频发布日期」补
// 思路来自布锅锅；接口需先拿 buvid3 cookie，且必须限速
// ---------------------------------------------------------------------------
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const PREFERRED_AUTHORS = ['白礼白里白', 'SkinSpotlights']
let biliCookie = ''
let biliCookieAt = 0
let biliRunning = null

function httpReq(url, headers = {}, timeout = 20000) {
  const https = require('node:https')
  return new Promise((resolve) => {
    const u = new URL(url)
    const q = https.request({ host: u.hostname, path: u.pathname + u.search, timeout, headers }, (res) => {
      const c = []
      res.on('data', (d) => c.push(d))
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString('utf8') })
      )
    })
    q.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message }))
    q.on('timeout', () => {
      q.destroy()
      resolve({ status: 0, headers: {}, body: 'timeout' })
    })
    q.end()
  })
}

async function ensureBiliCookie(force = false) {
  if (!force && biliCookie && Date.now() - biliCookieAt < 30 * 60 * 1000) return biliCookie
  const r = await httpReq('https://www.bilibili.com/', { 'User-Agent': UA, Accept: 'text/html' })
  biliCookie = (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ')
  biliCookieAt = Date.now()
  return biliCookie
}

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '')
const normName = (s) =>
  String(s || '')
    .replace(/[\s\u3000·・\-—_/\\|,，、.。!！?？"'“”‘’()（）【】]/g, '')
    .toLowerCase()

function pickBestDate(list, skinName) {
  const target = normName(skinName)
  if (!target) return null
  const valid = (list || [])
    .map((x) => ({
      title: stripTags(x.title),
      author: x.author,
      pubdate: x.pubdate,
      match: normName(stripTags(x.title)).includes(target) ? 1 : 0,
      preferred: PREFERRED_AUTHORS.includes(x.author) ? 1 : 0,
      isPbe: /pbe|测试服|预览/i.test(stripTags(x.title)) ? -1 : 0,
    }))
    .filter((x) => x.match === 1)
  if (!valid.length) return null
  valid.sort((a, b) => b.preferred - a.preferred || b.isPbe - a.isPbe || a.pubdate - b.pubdate)
  const b = valid[0]
  return {
    date: new Date(b.pubdate * 1000).toISOString().slice(0, 10),
    author: b.author,
    title: b.title.slice(0, 60),
  }
}

async function searchSkinOnBili(skinName) {
  const ck = await ensureBiliCookie()
  const url =
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + encodeURIComponent(skinName)
  const r = await httpReq(url, {
    'User-Agent': UA,
    Referer: 'https://search.bilibili.com/',
    Accept: 'application/json',
    Cookie: ck,
  })
  if (r.status === 412) {
    await ensureBiliCookie(true)
    return { ok: false, error: '412' }
  }
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` }
  let j
  try {
    j = JSON.parse(r.body)
  } catch {
    return { ok: false, error: 'json' }
  }
  if (j.code !== 0) return { ok: false, error: `code ${j.code}` }
  const hit = pickBestDate((j.data && j.data.result) || [], skinName)
  return hit ? { ok: true, ...hit } : { ok: false, error: 'no-match' }
}

/**
 * 补全缺失的上线时间（限速 1.8 秒/次）
 * @param {{limit?:number}} opts 每次最多补几个，默认 20
 */
async function fillMissingFromBili({ limit = 20 } = {}) {
  if (biliRunning) return biliRunning
  const { lcuRequest } = require('./lcu/api')
  const connection = require('./lcu/connection')

  biliRunning = (async () => {
    const conn = await connection.discover()
    if (!conn) return { ok: false, reason: 'no-client' }
    const r = await lcuRequest(conn, '/lol-game-data/assets/v1/skins.json', { timeout: 60000 })
    if (r.status !== 200 || !r.json) return { ok: false, reason: 'no-skins' }

    const raw = readDisk()
    const data = raw || { skins: {}, count: 0 }
    const all = Object.values(r.json).filter((s) => !s.isBase && s.name)
    const missing = all.filter((s) => !data.skins[s.id])
    if (!missing.length) return { ok: true, filled: 0, remaining: 0 }

    const todo = missing.slice(0, limit)
    let filled = 0
    for (const s of todo) {
      const hit = await searchSkinOnBili(s.name)
      if (hit.ok) {
        data.skins[s.id] = {
          release: hit.date,
          releaseAt: Date.parse(hit.date) || null,
          name: s.name,
          source: 'bilibili',
          evidence: `${hit.author} · ${hit.title}`,
        }
        filled += 1
      }
      await new Promise((res) => setTimeout(res, 1800))
    }
    data.fetchedAt = new Date().toISOString()
    data.count = Object.keys(data.skins).length
    data.biliFilled = (data.biliFilled || 0) + filled
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true })
      fs.writeFileSync(FILE, JSON.stringify(data), 'utf8')
      cache = data
    } catch {
      /* ignore */
    }
    return { ok: true, filled, remaining: missing.length - filled, total: data.count }
  })().finally(() => {
    biliRunning = null
  })

  return biliRunning
}

module.exports = { load, getRelease, meta, monthLabel, ageYears, FILE, fillMissingFromBili }