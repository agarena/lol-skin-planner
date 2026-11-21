'use strict'
/**
 * 英雄强度数据（OP.GG）
 *
 * 接口与 LeagueAkari 的实现完全一致（从它的 app.asar 里核对的）：
 *   BASE = https://lol-api-champion.op.gg
 *   GET /api/{region}/champions/{mode}              列表（含 tier / 胜率 / 选取率 / ban 率）
 *   GET /api/{region}/champions/{mode}/{id}         单英雄（arena/aram）
 *   GET /api/{region}/champions/{mode}/{id}/{pos}   单英雄分路（ranked）
 *
 * mode: ranked | aram | arena | urf
 * region: global | kr | na | euw …（国服腾讯服不在支持列表里，用 global 全球数据）
 *
 * 返回结构（节选）：
 *   { id: 103, average_stats: { play, win_rate, pick_rate, ban_rate, kda, tier, rank, tier_data } }
 *   tier 1~5，1 最强；rank 是该模式下的总排名
 *
 * 缓存：内存 + 磁盘各 1 小时（OP.GG 每天更新几次，没必要频繁拉）
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')

const BASE = 'https://lol-api-champion.op.gg'
const CACHE_FILE = path.join(os.tmpdir(), 'lol-champion-stats.json')
const TTL = 60 * 60 * 1000

const MODES = {
  ranked: '排位',
  aram: '极地大乱斗',
  arena: '斗魂竞技场',
  urf: '无限火力',
}

let mem = null

function httpGetJson(url, timeout = 20000) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
          Accept: 'application/json',
          Origin: 'https://op.gg',
          Referer: 'https://op.gg/lol/champions',
        },
      },
      (res) => {
        const c = []
        res.on('data', (d) => c.push(d))
        res.on('end', () => {
          const t = Buffer.concat(c).toString('utf8')
          let j = null
          try {
            j = JSON.parse(t)
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, json: j, raw: t.slice(0, 120) })
        })
      }
    )
    req.on('error', (e) => resolve({ status: 0, json: null, raw: e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, json: null, raw: 'timeout' })
    })
    req.end()
  })
}

function readDisk() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (j && j.at && Date.now() - j.at < TTL && j.byMode) return j
  } catch {
    /* none */
  }
  return null
}

function writeDisk(payload) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), 'utf8')
  } catch {
    /* ignore */
  }
}

/** 把一条 average_stats 归一化 */
function normalize(entry, mode) {
  const s = entry.average_stats || {}
  return {
    championId: entry.id,
    mode,
    tier: s.tier != null ? s.tier : null, // 1 最强
    rank: s.rank != null ? s.rank : null,
    winRate: s.win_rate != null ? Math.round(s.win_rate * 1000) / 10 : null, // 51.6
    pickRate: s.pick_rate != null ? Math.round(s.pick_rate * 1000) / 10 : null,
    banRate: s.ban_rate != null ? Math.round(s.ban_rate * 1000) / 10 : null,
    kda: s.kda != null ? Math.round(s.kda * 100) / 100 : null,
    games: s.play != null ? s.play : null,
    positions: Array.isArray(entry.positions)
      ? entry.positions.map((p) => ({ name: p.name, winRate: p.stats ? Math.round(p.stats.win_rate * 1000) / 10 : null }))
      : [],
  }
}

/**
 * 拉取指定模式的全英雄数据
 * @param {'ranked'|'aram'|'arena'|'urf'} mode
 * @param {{force?:boolean, region?:string}} opts
 */
async function getModeStats(mode = 'ranked', { force = false, region = 'global' } = {}) {
  const key = `${region}:${mode}`

  if (!force) {
    if (mem && mem.byMode[key] && Date.now() - mem.at < TTL) return mem.byMode[key]
    const disk = readDisk()
    if (disk && disk.byMode[key]) {
      mem = disk
      return disk.byMode[key]
    }
  }

  const r = await httpGetJson(`${BASE}/api/${region}/champions/${mode}`)
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.data)) {
    return { available: false, mode, region, reason: `HTTP ${r.status} ${r.raw || ''}`, byChampion: {}, list: [] }
  }

  const list = r.json.data.map((e) => normalize(e, mode))
  const byChampion = Object.fromEntries(list.map((x) => [x.championId, x]))

  const payload = {
    available: true,
    mode,
    region,
    fetchedAt: Date.now(),
    count: list.length,
    list,
    byChampion,
  }

  mem = mem && Date.now() - mem.at < TTL ? mem : { at: Date.now(), byMode: {} }
  mem.at = Date.now()
  mem.byMode[key] = payload
  writeDisk(mem)
  return payload
}

/**
 * 一次拿多模式（排位 + 大乱斗），供 UI / CLI 使用
 * @param {{modes?:string[], force?:boolean}} opts
 */
async function getAll({ modes = ['ranked', 'aram'], force = false } = {}) {
  const out = { fetchedAt: Date.now(), modes: {}, byChampion: {} }
  for (const m of modes) {
    const d = await getModeStats(m, { force })
    out.modes[m] = {
      available: d.available,
      reason: d.reason || null,
      count: d.count || 0,
      label: MODES[m] || m,
    }
    for (const [id, s] of Object.entries(d.byChampion || {})) {
      if (!out.byChampion[id]) out.byChampion[id] = {}
      out.byChampion[id][m] = s
    }
  }
  return out
}

/** 单英雄的强度摘要 */
async function getChampionStats(championId, { modes = ['ranked', 'aram'], force = false } = {}) {
  const all = await getAll({ modes, force })
  const id = Number(championId)
  return {
    championId: id,
    stats: all.byChampion[id] || {},
    modes: all.modes,
    fetchedAt: all.fetchedAt,
  }
}

module.exports = { getModeStats, getAll, getChampionStats, MODES, BASE }
