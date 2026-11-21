'use strict'
/**
 * 数据层统一入口（纯 Node，零 Electron 依赖）
 *
 * 三种调用方共用这一层：
 *   - electron/main.js  桌面窗口
 *   - cli/lol.js        命令行（skill / LLM 调用）
 *   - 任意 Node 脚本
 */
const connection = require('./lcu/connection')
const collectionMod = require('./lcu/collection')
const catalog = require('./lcu/catalog')
const store = require('./lcu/store')
const mastery = require('./lcu/mastery')
const usageMod = require('./usage')
const analyzer = require('./analyzer')
const filters = require('./lcu/filters')
const skinprefs = require('./lcu/skinprefs')
const storeitems = require('./lcu/storeitems')
const mythicshop = require('./mythicshop')
const championstats = require('./championstats')
const plans = require('./plans')

/** 由宿主注入缓存目录（Electron 用 userData，CLI 默认临时目录） */
function configure({ cacheDir } = {}) {
  if (cacheDir) catalog.setCacheDir(cacheDir)
}

async function requireConn() {
  const conn = await connection.discover()
  if (!conn) {
    const diag = connection.diagnose()
    const err = new Error(diag.reason || '未检测到客户端')
    err.code = diag.needsElevation ? 'NEEDS_ELEVATION' : 'NO_CLIENT'
    err.diagnose = diag
    throw err
  }
  return conn
}

async function status({ force = false } = {}) {
  const conn = await connection.discover({ force })
  if (!conn) {
    const diag = connection.diagnose()
    return { connected: false, ...diag }
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
    },
  }
}

let colCache = { at: 0, data: null, sid: null }

async function getCollection({ force = false, ttl = 300000 } = {}) {
  const conn = await requireConn()
  const sid = (conn.summoner && conn.summoner.summonerId) || null
  if (!force && colCache.data && colCache.sid === sid && Date.now() - colCache.at < ttl) {
    return colCache.data
  }
  const data = await collectionMod.getCollection(conn)
  colCache = { at: Date.now(), data, sid }
  return data
}

async function getUsage({ force = false, count = 100 } = {}) {
  const conn = await requireConn()
  const puuid = (conn.summoner && conn.summoner.puuid) || null
  return usageMod.buildUsage(conn, puuid, { force, count })
}

async function getPrices({ skinIds = null } = {}) {
  const conn = await requireConn()
  return store.fetchPrices(conn, { skinIds })
}

/**
 * 清单分析
 * @param {string} text 每行一个「皮肤名 + 英雄名」
 * @param {{withPrices?:boolean, withUsage?:boolean, refresh?:boolean, prices?:object}} opts
 */
async function analyze(text, opts = {}) {
  const { withPrices = true, withUsage = true, refresh = false } = opts
  const conn = await requireConn()
  const [col, cat] = await Promise.all([
    getCollection({ force: refresh }),
    catalog.load(conn),
  ])

  // 先解析出清单里到底有哪些皮肤，只给它们查价
  // （以前是给全部 2140 个皮肤逐个查，光这一步就要 3-5 秒）
  const preFound = analyzer.extractSkinNames(text, cat, col.champions)
  const wantIds = preFound.map((s) => s.id)

  let prices = opts.prices || {}
  if (withPrices && !Object.keys(prices).length && wantIds.length) {
    prices = await store.fetchPrices(conn, { skinIds: wantIds }).catch(() => ({}))
    if (!Object.keys(prices).length) prices = {}
  }

  let usg = null
  if (withUsage) {
    usg = await getUsage().catch(() => null)
  }

  // 英雄强度梯度（OP.GG），用于在推荐理由里标注「这个英雄当前强不强」
  // 梯度数据只作为附加信息：有缓存就秒回，没缓存最多等 600ms，绝不拖慢分析
  let stats = null
  if (opts.withStats !== false) {
    stats = await Promise.race([
      championstats.getAll({ modes: ['ranked', 'aram'] }).catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 600)),
    ])
  }

  const result = analyzer.analyze(text, col, cat, prices, usg, stats)
  return { ...result, stats: col.stats, summoner: col.summoner }
}

/** 单品：账号状态 + 静态元数据 + 商城价格 */
async function getSkin(skinId) {
  const id = Number(skinId)
  const conn = await requireConn()
  const [col, cat] = await Promise.all([getCollection(), catalog.load(conn)])
  const meta = cat.skins[id] || null
  if (!meta) throw Object.assign(new Error(`没有 id=${id} 的皮肤`), { code: 'NOT_FOUND' })

  const champ = col.champions.find((c) => c.id === meta.championId) || null
  const own = champ ? champ.skins.find((s) => s.id === id) : null

  let price = null
  try {
    const r = await require('./lcu/api').lcuRequest(conn, `/lol-store/v1/skins/${id}`, { timeout: 8000 })
    if (r.status === 200 && r.json) price = store.normalizeItem(r.json)
  } catch {
    /* 价格可选 */
  }

  return {
    skinId: id,
    name: meta.name,
    championId: meta.championId,
    championName: meta.championName,
    rarity: meta.rarity,
    rarityLabel: meta.rarityLabel,
    rarityRank: meta.rarityRank,
    legacy: meta.legacy,
    lines: meta.lines,
    owned: !!(own && own.owned),
    championOwned: !!(champ && champ.owned),
    championOwnedSkinCount: champ ? champ.ownedSkinCount : 0,
    championMaxRarityLabel: champ ? champ.maxOwnedRarityLabel : '',
    price,
  }
}

async function getChampionStats(opts = {}) {
  return championstats.getAll(opts)
}

async function getMythicShop(opts = {}) {
  const conn = await requireConn()
  return mythicshop.getMythicShop(conn, opts)
}

async function getStoreItems(opts = {}) {
  const conn = await requireConn()
  return storeitems.getStoreItems(conn, opts)
}

/** 某个英雄的全部皮肤 + 我的状态 */
async function getChampion(championId) {
  const id = Number(championId)
  const col = await getCollection()
  const champ = col.champions.find((c) => c.id === id)
  if (!champ) throw Object.assign(new Error(`没有 id=${id} 的英雄`), { code: 'NOT_FOUND' })
  return champ
}

/**
 * 每个英雄「上次在选人界面选的皮肤」
 * 来源是客户端配置文件 LCUAccountPreferences.yaml，不需要进游戏
 */
async function getSkinPreferences() {
  const conn = await requireConn()
  const cat = await catalog.load(conn)
  return skinprefs.readSkinPreferences(conn, cat)
}

/**
 * 当前选人阶段我锁定的英雄与皮肤
 *
 * 注意：LOL 没有「为英雄持久装备皮肤」的概念，每次选人现选一次，
 * 客户端只在本次会话内用 lastSelected 记住（国服实测恒为 false）。
 * 所以「当前用哪个皮肤」只有选人阶段能读到。
 */
async function getCurrentSelection() {
  const conn = await requireConn()
  const phase = await require('./lcu/api').lcuRequest(conn, '/lol-gameflow/v1/gameflow-phase', {
    timeout: 8000,
  })
  const currentPhase = phase.status === 200 ? String(phase.json || '').replace(/"/g, '') : ''

  const r = await require('./lcu/api').lcuRequest(conn, '/lol-champ-select/v1/session', {
    timeout: 8000,
  })
  if (r.status !== 200 || !r.json) {
    return {
      inChampSelect: false,
      phase: currentPhase,
      reason: '不在选人阶段（只有进入 BP 界面时才能读到当前选的皮肤）',
    }
  }
  const s = r.json
  const me = (s.myTeam || []).find((p) => p.cellId === s.localPlayerCellId) || null
  const championId = me ? me.championId : 0
  const selectedSkinId = me ? me.selectedSkinId : 0

  let skin = null
  if (selectedSkinId) {
    const cat = await catalog.load(conn).catch(() => null)
    const meta = cat && cat.skins[selectedSkinId]
    skin = meta
      ? { id: meta.id, name: meta.name, rarityLabel: meta.rarityLabel, isBase: meta.isBase }
      : { id: selectedSkinId, name: '', rarityLabel: '', isBase: championId && selectedSkinId === championId * 1000 }
  }

  return {
    inChampSelect: true,
    phase: currentPhase,
    championId,
    selectedSkinId,
    skin,
    skinLocked: !!(me && me.selectedSkinId),
    sessionId: s.id || null,
  }
}

/** 常用英雄榜（成就 + 对局） */
async function getTopChampions({ limit = 20, force = false } = {}) {
  const [usg, col] = await Promise.all([getUsage({ force }), getCollection()])
  const nameOf = new Map(col.champions.map((c) => [c.id, c.name]))
  const ownedOf = new Map(col.champions.map((c) => [c.id, c]))
  return usg.champions.slice(0, limit).map((u) => {
    const c = ownedOf.get(u.championId)
    return {
      rank: u.rank,
      championId: u.championId,
      championName: nameOf.get(u.championId) || String(u.championId),
      masteryLevel: u.masteryLevel,
      masteryPoints: u.masteryPoints,
      games: u.games,
      recent30: u.recent30,
      winRate: u.winRate,
      score: Math.round(u.score),
      ownedSkinCount: c ? c.ownedSkinCount : 0,
      maxRarityLabel: c ? c.maxOwnedRarityLabel : '',
    }
  })
}

// ---- 方案 ----
async function listPlans() {
  return plans.listPlans()
}

async function savePlan(payload) {
  return payload && payload.id ? plans.updatePlan(payload.id, payload) : plans.createPlan(payload || {})
}

async function deletePlan(id) {
  return plans.deletePlan(id)
}

module.exports = {
  plans,
  listPlans,
  savePlan,
  deletePlan,
  configure,
  plansConfigure: (dir) => plans.configure({ dataDir: dir }),
  getConnection: requireConn,
  status,
  getCollection,
  getUsage,
  getPrices,
  analyze,
  getSkin,
  getChampion,
  getCurrentSelection,
  getSkinPreferences,
  getStoreItems,
  getMythicShop,
  getChampionStats,
  getTopChampions,
  // 低层能力，供特殊场景直接调用
  catalog,
  connection,
  mastery,
  filters,
  analyzer,
}
