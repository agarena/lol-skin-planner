'use strict'
/**
 * 静态皮肤元数据（等级 / 中文名 / 系列 / 绝版标记）
 * 首选来源：本地客户端的 lol-game-data（跟随客户端语言，国服=简体中文，离线可用）
 * 缓存：userData/cache/skins-<locale>.json
 */
const fs = require('node:fs')
const path = require('node:path')
const { lcuRequest } = require('./api')
const filters = require('./filters')

/** Riot 稀有度 → 中文档位 + 排序权重（越大越高级） */
const RARITY = {
  kTranscendent: { label: '圣堂', rank: 8 },
  kExalted: { label: '卓越', rank: 7 },
  kUltimate: { label: '终极', rank: 6 },
  kMythic: { label: '神话', rank: 5 },
  kLegendary: { label: '传说', rank: 4 },
  kEpic: { label: '史诗', rank: 3 },
  kRare: { label: '稀有', rank: 2 },
  kNoRarity: { label: '普通', rank: 1 },
  '': { label: '普通', rank: 1 },
}

function rarityInfo(raw) {
  return RARITY[raw] || RARITY['']
}

/** 过滤器版本：递增即可让旧缓存自动失效（避免经典模式数据残留） */
const FILTER_VERSION = 6

let memCache = null

/**
 * 缓存目录可注入：Electron 传 userData/cache，CLI 默认用系统临时目录。
 * 这样数据层不依赖 Electron，可被 CLI / skill / 任意 Node 进程复用。
 */
const os = require('node:os')
let cacheDir = path.join(os.tmpdir(), 'lol-skin-planner', 'cache')

function setCacheDir(dir) {
  if (!dir) return
  cacheDir = dir
  memCache = null
}

function getCacheDir() {
  return cacheDir
}

function cacheFile() {
  return { dir: cacheDir, file: path.join(cacheDir, 'skins.json') }
}

function readDisk() {
  try {
    const { file } = cacheFile()
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw)
    if (!data || !data.skins || !data.champions) return null
    if (data.filterVersion !== FILTER_VERSION) return null
    return data
  } catch {
    return null
  }
}

function writeDisk(data) {
  try {
    const { dir, file } = cacheFile()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(data), 'utf8')
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

function championIdOfSkin(skinId) {
  return Math.floor(Number(skinId) / 1000)
}

/** 把两个原始 JSON 编译成检索友好的结构（跳过经典模式条目） */
function compile(rawSkins, rawChampions, lineNames, lineToUniverse) {
  const champions = {}
  let skippedChampions = 0
  for (const c of rawChampions || []) {
    if (!c || !c.id) continue
    if (filters.isClassicChampion(c)) {
      skippedChampions += 1
      continue
    }
    champions[c.id] = {
      id: c.id,
      name: c.name,
      alias: c.alias || '',
      title: c.title || '',
      roles: Array.isArray(c.roles) ? c.roles : [],
    }
  }
  const skins = {}
  let skippedSkins = 0
  for (const key of Object.keys(rawSkins || {})) {
    const s = rawSkins[key]
    if (!s || !s.id) continue
    if (filters.isClassicSkinId(s.id)) {
      skippedSkins += 1
      continue
    }
    const championId = championIdOfSkin(s.id)
    const champ = champions[championId] || null
    const r = rarityInfo(s.rarity)
    skins[s.id] = {
      id: s.id,
      name: s.name,
      championId,
      championName: champ ? champ.name : '',
      isBase: !!s.isBase,
      rarity: s.rarity || '',
      rarityLabel: r.label,
      rarityRank: r.rank,
      legacy: !!s.isLegacy,
      lines: (s.skinLines || [])
        .map((l) => (lineNames && lineNames.get(l.id)) || (l && l.name) || '')
        .filter(Boolean),
      universes: [
        ...new Set(
          (s.skinLines || [])
            .map((l) => (lineToUniverse && lineToUniverse.get(l.id)) || '')
            .filter(Boolean)
        ),
      ],
      tilePath: s.tilePath || s.uncenteredSplashPath || '',
      splashPath: s.uncenteredSplashPath || '',
      chromaCount: Array.isArray(s.chromas) ? s.chromas.length : 0,
    }
  }
  return { skins, champions, skippedChampions, skippedSkins }
}

async function load(conn, { force = false } = {}) {
  if (!force && memCache) return memCache
  if (!force) {
    const disk = readDisk()
    if (disk && Date.now() - (disk.fetchedAt || 0) < 6 * 3600 * 1000) {
      memCache = disk
      return memCache
    }
  }
  if (conn) {
    const [skinsRes, champRes, lineRes, uniRes] = await Promise.all([
      lcuRequest(conn, '/lol-game-data/assets/v1/skins.json', { timeout: 25000 }),
      lcuRequest(conn, '/lol-game-data/assets/v1/champion-summary.json', { timeout: 20000 }),
      lcuRequest(conn, '/lol-game-data/assets/v1/skinlines.json', { timeout: 15000 }),
      lcuRequest(conn, '/lol-game-data/assets/v1/universes.json', { timeout: 15000 }),
    ])
    const lineNames = new Map(
      (lineRes.status === 200 && Array.isArray(lineRes.json) ? lineRes.json : []).map((l) => [l.id, l.name])
    )
    const lineToUniverse = new Map()
    for (const u of (uniRes.status === 200 && Array.isArray(uniRes.json) ? uniRes.json : [])) {
      for (const sid of u.skinSets || []) {
        if (!lineToUniverse.has(sid)) lineToUniverse.set(sid, u.name)
      }
    }

    if (skinsRes.status === 200 && skinsRes.json && champRes.status === 200 && champRes.json) {
      const compiled = compile(skinsRes.json, champRes.json, lineNames, lineToUniverse)
      const data = {
        skins: compiled.skins,
        champions: compiled.champions,
        fetchedAt: Date.now(),
        source: 'lcu-game-data',
        skinCount: Object.keys(compiled.skins).length,
        championCount: Object.keys(compiled.champions).length,
        skippedChampions: compiled.skippedChampions,
        skippedSkins: compiled.skippedSkins,
        filterVersion: FILTER_VERSION,
      }
      memCache = data
      writeDisk(data)
      return data
    }
  }
  const disk = readDisk()
  if (disk) {
    memCache = disk
    return disk
  }
  return { skins: {}, champions: {}, fetchedAt: 0, source: 'none', skinCount: 0, championCount: 0 }
}

function getCached() {
  return memCache || readDisk()
}

function clear() {
  memCache = null
  try {
    const { file } = cacheFile()
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch {
    /* ignore */
  }
}

module.exports = { load, getCached, clear, rarityInfo, RARITY, championIdOfSkin, setCacheDir, getCacheDir }
