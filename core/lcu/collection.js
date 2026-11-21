'use strict'
/** 账号藏品采集：英雄拥有情况 + 每个英雄的皮肤拥有情况 */
const { lcuRequest } = require('./api')
const catalog = require('./catalog')
const filters = require('./filters')
const lootMod = require('./loot')
const prestige = require('../prestige')
const releaseDb = require('../release')

async function getSummoner(conn) {
  const r = await lcuRequest(conn, '/lol-summoner/v1/current-summoner')
  if (r.status !== 200 || !r.json) {
    throw Object.assign(new Error('读取召唤师信息失败'), { code: 'SUMMONER_FAIL', status: r.status })
  }
  const me = r.json
  return {
    summonerId: me.summonerId,
    accountId: me.accountId,
    gameName: me.gameName || me.displayName || '',
    tagLine: me.tagLine || '',
    level: me.summonerLevel,
    profileIconId: me.profileIconId,
    puuid: me.puuid,
  }
}

async function getWallet(conn) {
  // 注意：/lol-inventory/v1/wallet 裸调会 400（它要求 currencyTypes 是 vector），
  // 加任意一个币种子路径即可拿到完整多币种对象
  const r = await lcuRequest(conn, '/lol-inventory/v1/wallet/IP')
  if (r.status !== 200 || !r.json) return { rp: null, ip: null, mythic: null, raw: null }
  const j = r.json
  return {
    rp: j.RP ?? null,
    ip: j.lol_blue_essence ?? null,
    mythic: j.lol_mythic_essence ?? null,
    orange: j.lol_orange_essence ?? null,
    raw: j,
  }
}

/**
 * 拉取完整藏品
 * @returns 结构化：英雄（是否拥有 + 皮肤清单）与统计
 */
let _cache = { at: 0, sid: null, data: null }
const CACHE_TTL = 5 * 60 * 1000

async function getCollection(conn, { withLoot = true, force = false, ttl = CACHE_TTL } = {}) {
  const me = await getSummoner(conn)
  // 模块级缓存：storeItems / CLI / 界面共用，避免重复重建（重建约 1.8s）
  if (!force && _cache.data && _cache.sid === me.summonerId && Date.now() - _cache.at < ttl) {
    return _cache.data
  }
  const cat = await catalog.load(conn)
  const lootIdx = await lootMod.getLootIndex(conn).catch(() => ({ bySkinId: {} }))
  const res = await lcuRequest(
    conn,
    `/lol-champions/v1/inventories/${me.summonerId}/champions`,
    { timeout: 30000 }
  )
  if (res.status !== 200 || !Array.isArray(res.json)) {
    throw Object.assign(new Error('读取英雄/皮肤藏品失败'), {
      code: 'COLLECTION_FAIL',
      status: res.status,
    })
  }

  // 剔除经典模式（Jade）英雄与占位项，再按名字去重，避免出现两个「暗裔剑魔」
  const { list: cleanChampions, removed } = filters.filterChampions(res.json)

  const champions = []
  let skinOwnedCount = 0
  let skinTotalCount = 0
  let championOwnedCount = 0

  for (const c of cleanChampions) {
    const owned = !!(c.ownership && c.ownership.owned)
    if (owned) championOwnedCount += 1
    const champMeta = cat.champions[c.id] || null
    const skins = []
    for (const s of c.skins || []) {
      if (filters.isClassicSkinId(s.id)) continue
      const meta = cat.skins[s.id] || null
      const sOwned = !!(s.ownership && (s.ownership.owned || (s.ownership.rental && s.ownership.rental.rented)))
      if (!s.isBase) {
        skinTotalCount += 1
        if (sOwned) skinOwnedCount += 1
      }
      skins.push({
        id: s.id,
        name: (meta && meta.name) || s.name,
        rawName: s.name,
        isBase: !!s.isBase,
        owned: sOwned,
        state: lootMod.skinState(sOwned, lootIdx.bySkinId[s.id]),
        rarity: (meta && meta.rarity) || '',
        rarityLabel: (meta && meta.rarityLabel) || '普通',
        rarityRank: (meta && meta.rarityRank) || 1,
        legacy: !!(meta && meta.legacy),
        lines: (meta && meta.lines) || [],
        tilePath: s.tilePath || (meta && meta.tilePath) || '',
        splashPath: s.uncenteredSplashPath || (meta && meta.splashPath) || '',
        releaseAt: (releaseDb.getRelease(s.id) || {}).releaseAt || 0,
        releaseLabel: (releaseDb.getRelease(s.id) || {}).release || null,
        gemPath: s.rarityGemPath || '',
        chromas: (s.chromas || []).length,
        chromaList: (s.chromas || []).map((x) => ({
          id: x.id,
          name: x.name,
          owned: !!(x.ownership && x.ownership.owned),
          prestige: prestige.isPrestige(x.id),
        })),
        prestigeChromas: (s.chromas || []).filter((x) => prestige.isPrestige(x.id)).length,
        stillObtainable: !!s.stillObtainable,
      })
    }
    const nonBase = skins.filter((s) => !s.isBase)
    const ownedNonBase = nonBase.filter((s) => s.owned)
    const maxRank = ownedNonBase.reduce((m, s) => Math.max(m, s.rarityRank), 0)
    const topSkin = ownedNonBase
      .filter((s) => s.rarityRank === maxRank)
      .sort((a, b) => b.id - a.id)[0]
    champions.push({
      id: c.id,
      name: (champMeta && champMeta.name) || c.name,
      alias: c.alias || (champMeta && champMeta.alias) || '',
      roles: (champMeta && champMeta.roles) || c.roles || [],
      owned,
      freeToPlay: !!c.freeToPlay,
      skins,
      ownedSkinCount: ownedNonBase.length,
      totalSkinCount: nonBase.length,
      maxOwnedRarityRank: maxRank,
      maxOwnedRarityLabel: topSkin ? topSkin.rarityLabel : '',
    })
  }

  champions.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))

  let loot = []
  if (withLoot) {
    const lr = await lcuRequest(conn, '/lol-loot/v1/player-loot', { timeout: 20000 })
    if (lr.status === 200 && Array.isArray(lr.json)) {
      loot = lr.json
        .filter((x) => x && x.storeItemId)
        .map((x) => ({
          storeItemId: x.storeItemId,
          lootId: x.lootId,
          name: x.localizedName,
          count: x.count,
          status: x.itemStatus,
          type: x.type,
        }))
    }
  }

  const wallet = await getWallet(conn)

  const result = {
    summoner: {
      ...me,
      rp: wallet.rp,
      ip: wallet.ip,
      mythic: wallet.mythic,
    },
    champions,
    loot,
    stats: {
      championOwned: championOwnedCount,
      championTotal: champions.length,
      skinOwned: skinOwnedCount,
      skinTotal: skinTotalCount,
      rawChampionCount: res.json.length,
      removedClassic: removed.variant,
      removedDuplicate: removed.dedupe,
      catalogSource: cat.source,
      catalogSkins: cat.skinCount,
      fetchedAt: Date.now(),
    },
  }

  _cache = { at: Date.now(), sid: me.summonerId, data: result }
  return result
}

/** 清空藏品缓存（手动刷新时用） */
function clearCollectionCache() {
  _cache = { at: 0, sid: null, data: null }
}

module.exports = { getCollection, getSummoner, getWallet, clearCollectionCache }
