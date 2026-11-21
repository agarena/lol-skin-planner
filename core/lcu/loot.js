'use strict'
/**
 * 战利品索引：把 player-loot 整理成「皮肤 ID → 战利品状态」
 *
 * 实测的 loot 类型（2026-11）：
 *   CHAMPION_SKIN            皮肤碎片（需要精粹合成）
 *   CHAMPION_SKIN_PERMANENT  永久皮肤（直接可解锁）
 *   CHAMPION_SKIN_RENTAL     皮肤体验卡（限时试用，不算拥有也不算碎片）
 *   CHAMPION / CHAMPION_RENTAL / CHEST / MATERIAL / CURRENCY / SUMMONERICON
 *
 * redeemableStatus 实测值：REDEEMABLE / REDEEMABLE_RENTAL / ALREADY_OWNED / NOT_REDEEMABLE / REQUIRES_LOOT
 *
 * 用户要的四状态：
 *   owned        已拥有
 *   lootPermanent 战利品里有永久（可直接解锁）
 *   lootShard     战利品里有碎片（还差精粹）
 *   none          都没有
 */
const { lcuRequest } = require('./api')

const CACHE_TTL = 60 * 1000
let cache = { at: 0, data: null }

/**
 * 战利品类型（以 LCU 的 type 字段为准，实测 2026-11）
 *
 *   type: "SKIN"          → 完整皮肤（永久），upgradeLootName 为空，可直接用
 *   type: "SKIN_RENTAL"   → **皮肤碎片**，upgradeLootName 指向 CHAMPION_SKIN_xxx，可用精粹升级为永久
 *   type: "WARDSKIN" / "WARDSKIN_RENTAL" → 守卫皮肤及其碎片
 *
 * 注意 lootName 的前缀（CHAMPION_SKIN_xxx）不能用来判断类型 ——
 * 碎片和永久的前缀都叫 CHAMPION_SKIN，区别在 type 和 upgradeLootName。
 */
function classify(loot) {
  const type = String(loot.type || '').toUpperCase()
  const count = loot.count || 0

  if (type === 'SKIN') return { kind: 'permanent', count }
  if (type === 'SKIN_RENTAL') return { kind: 'shard', count }
  return null
}

/**
 * @returns {{ available:boolean, bySkinId:Object, stats:Object }}
 *   bySkinId[skinId] = { permanent:number, shard:number, rental:number }
 */
async function getLootIndex(conn, { force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_TTL) return cache.data

  const r = await lcuRequest(conn, '/lol-loot/v1/player-loot', { timeout: 20000 })
  if (r.status !== 200 || !Array.isArray(r.json)) {
    return { available: false, reason: `HTTP ${r.status}`, bySkinId: {}, stats: {} }
  }

  const bySkinId = {}
  const stats = { total: r.json.length, permanent: 0, shard: 0, rental: 0, other: 0 }

  for (const loot of r.json) {
    const c = classify(loot)
    if (!c) {
      stats.other += 1
      continue
    }
    const skinId = Number(loot.storeItemId)
    if (!skinId) continue
    if (!bySkinId[skinId]) bySkinId[skinId] = { permanent: 0, shard: 0, rental: 0 }
    if (c.kind === 'permanent') {
      bySkinId[skinId].permanent += c.count
      stats.permanent += c.count
    } else if (c.kind === 'shard' || c.kind === 'shard_incomplete') {
      bySkinId[skinId].shard += c.count
      stats.shard += c.count
    } else if (c.kind === 'rental') {
      bySkinId[skinId].rental += c.count
      stats.rental += c.count
    }
  }

  const data = { available: true, bySkinId, stats, fetchedAt: Date.now() }
  cache = { at: Date.now(), data }
  return data
}

/**
 * 合并出皮肤的四状态
 * @param {boolean} owned 藏品里的 ownership.owned
 * @param {object} lootEntry getLootIndex().bySkinId[skinId]
 */
function skinState(owned, lootEntry) {
  if (owned) return 'owned'
  if (lootEntry && lootEntry.permanent > 0) return 'lootPermanent'
  if (lootEntry && lootEntry.shard > 0) return 'lootShard'
  return 'none'
}

const STATE_LABELS = {
  owned: '已拥有',
  lootPermanent: '战利品可解锁',
  lootShard: '拥有碎片',
  none: '未拥有',
}

module.exports = { getLootIndex, skinState, STATE_LABELS, classify }
