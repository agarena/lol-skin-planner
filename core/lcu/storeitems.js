'use strict'
/**
 * 商城视图
 *
 * 数据源合并策略：
 *   全集 = 静态皮肤库 catalog.skins（2008 款，含所有皮肤）
 *   在售 = /lol-store/v1/skins（832 款去炫彩，直接带 rp / sale / owned）
 *   差额 = 不在 LCU 点券商城里的皮肤 → 标為「非点券直购」
 *
 * 为什么要合并：客户端商城里有一批皮肤只显示「前往获取」或「62 神话精萃」，
 * 它们不在 LCU 的点券商城数据里（那是腾讯自家商城页），但静态库里有名字和等级。
 * 所以这里以静态库为准列出全部，用「在售 / 非直购」区分。
 *
 * 两个口径坑（实测）：
 *   1. inactiveDate 大多是 2029/2099 占位值，只有真日期才是限时销售
 *   2. catalog 的 tags.limited 只有 5 条，不能当「限定」；限定用 skins.json 的 isLegacy
 */
const { lcuRequest } = require('./api')
const catalog = require('./catalog')
const collection = require('./collection')
const popular = require('../popular')
const releaseDb = require('../release')
const mythicSale = require('../mythicsale')
const lootMod = require('./loot')

const PLACEHOLDER_YEARS = ['2029', '2099']

function isPlaceholderDate(d) {
  const s = String(d || '')
  if (!s) return true
  return PLACEHOLDER_YEARS.some((y) => s.startsWith(y))
}

let _rawCache = { at: 0, skinItems: null, featuredIds: null }
const RAW_TTL = 5 * 60 * 1000

async function getStoreItems(conn, { view = 'all', onlyUnowned = false, force = false } = {}) {
  // /lol-store/v1/skins 本身要 400ms，缓存 60 秒
  let skinItems = null
  let featuredIds = null
  if (!force && _rawCache.skinItems && Date.now() - _rawCache.at < RAW_TTL) {
    skinItems = _rawCache.skinItems
    featuredIds = _rawCache.featuredIds
  } else {
    const [skinPage, featuredRes] = await Promise.all([
      lcuRequest(conn, '/lol-store/v1/skins', { timeout: 60000 }),
      lcuRequest(conn, '/lol-store/v1/featured', { timeout: 15000 }),
    ])
    const rawItems = (skinPage.json && (skinPage.json.catalog || skinPage.json)) || []
    skinItems = Array.isArray(rawItems) ? rawItems : []
    featuredIds = new Set(
      ((featuredRes.json && (featuredRes.json.catalog || featuredRes.json)) || [])
        .filter((x) => x && x.inventoryType === 'CHAMPION_SKIN')
        .map((x) => x.itemId)
    )
    _rawCache = { at: Date.now(), skinItems, featuredIds }
  }
  const items = skinItems

  // 在售表：itemId → 商城条目
  const storeMap = new Map()
  for (const it of items) {
    if (!it || it.inventoryType !== 'CHAMPION_SKIN') continue
    storeMap.set(it.itemId, it)
  }

  const [cat, lootIdx] = await Promise.all([
    catalog.load(conn),
    lootMod.getLootIndex(conn).catch(() => ({ bySkinId: {} })),
  ])

  // 拥有状态：在售的用商城字段，其余用藏品
  let ownedSet = new Set()
  try {
    const col = await collection.getCollection(conn)
    for (const c of col.champions) for (const s of c.skins) if (s.owned) ownedSet.add(s.id)
  } catch {
    /* 拿不到藏品就只信商城字段 */
  }

  const out = []
  for (const key of Object.keys(cat.skins)) {
    const meta = cat.skins[key]
    if (!meta || meta.isBase) continue

    const skinId = meta.id
    const st = storeMap.get(skinId) || null
    const isRecolor = st && String(st.subInventoryType || '').toUpperCase() === 'RECOLOR'
    if (isRecolor) continue // 炫彩不混在皮肤里

    const inStore = !!st
    const baseRp = st && typeof st.rp === 'number' ? st.rp : null
    const sale = (st && st.sale) || null
    const pct = sale && typeof sale.percentOff === 'number' ? sale.percentOff : 0
    const nowRp = sale && typeof sale.rp === 'number' ? sale.rp : baseRp

    const limitedTime = inStore && !isPlaceholderDate(st.inactiveDate)
    const relHit = releaseDb.getRelease(skinId)

    out.push({
      skinId,
      name: meta.name,
      championId: meta.championId,
      championName: meta.championName,
      rarity: meta.rarity,
      rarityLabel: meta.rarityLabel,
      rarityRank: meta.rarityRank,
      lines: meta.lines || [],
      universes: meta.universes || [],
      legacy: meta.legacy,
      limitedTime,
      inactiveDate: limitedTime ? st.inactiveDate : null,
      featured: featuredIds.has(skinId),
      owned: st ? !!st.owned : ownedSet.has(skinId),
      state: lootMod.skinState(st ? !!st.owned : ownedSet.has(skinId), lootIdx.bySkinId[skinId]),
      inStore,
      // 不在点券商城 → 非点券直购（神话精萃 / 活动 / 任务）
      purchasable: inStore && baseRp != null,
      onSale: inStore && pct > 0,
      rp: inStore ? nowRp : null,
      originalRp: inStore && pct > 0 ? baseRp : null,
      discountPct: inStore ? pct : 0,
      saleEnd: sale ? sale.endDate : null,
      releaseDate: (st && st.releaseDate) || (relHit ? relHit.releaseAt : 0) || 0,
      releaseLabel: relHit ? relHit.release : st && st.releaseDate ? new Date(st.releaseDate).toISOString().slice(0, 10) : null,
      popularity: popular.getPopularity(skinId),
      mythicSale: (() => {
        const s = mythicSale.getSale(skinId)
        return s && s.kind === 'mythic' ? s : null
      })(),
      tilePath: meta.tilePath || (st ? '' : ''),
      splashPath: meta.splashPath || '',
    })
  }

  const counts = {
    all: out.length,
    inStore: out.filter((x) => x.purchasable).length,
    notPurchasable: out.filter((x) => !x.purchasable).length,
    featured: out.filter((x) => x.featured).length,
    sale: out.filter((x) => x.onSale).length,
    limitedTime: out.filter((x) => x.limitedTime).length,
    legacy: out.filter((x) => x.legacy).length,
    unowned: out.filter((x) => !x.owned).length,
    mythicSale: out.filter((x) => x.mythicSale).length,
    mythicRpSale: out.filter((x) => x.onSale).length,
  }

  let list = out
  if (view === 'featured') list = out.filter((x) => x.featured)
  else if (view === 'sale') list = out.filter((x) => x.onSale)
  else if (view === 'limitedTime') list = out.filter((x) => x.limitedTime)
  else if (view === 'legacy') list = out.filter((x) => x.legacy)
  else if (view === 'notPurchasable') list = out.filter((x) => !x.purchasable)
  else if (view === 'newest') list = out.filter((x) => x.releaseDate).sort((a, b) => b.releaseDate - a.releaseDate)
  else if (view === 'mythicSale') list = out.filter((x) => x.mythicSale)

  if (onlyUnowned) list = list.filter((x) => !x.owned)

  list = [...list].sort((a, b) => {
    if (a.owned !== b.owned) return a.owned ? 1 : -1
    if (a.purchasable !== b.purchasable) return a.purchasable ? -1 : 1
    if (a.featured !== b.featured) return a.featured ? -1 : 1
    if (a.discountPct !== b.discountPct) return b.discountPct - a.discountPct
    const pa = a.popularity ? a.popularity.rank : 9999
    const pb = b.popularity ? b.popularity.rank : 9999
    if (pa !== pb) return pa - pb
    return b.rarityRank - a.rarityRank
  })

  return { view, counts, fetchedAt: Date.now(), items: list }
}

module.exports = { getStoreItems, isPlaceholderDate }
