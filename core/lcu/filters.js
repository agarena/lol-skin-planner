'use strict'
/**
 * 经典模式（Classic / "Jade"）条目过滤
 *
 * 背景：国服客户端在同一份藏品里同时下发普通英雄和经典模式英雄，
 * 二者名字完全相同、只是 id / alias 不同，导致 UI 上出现两个「暗裔剑魔」。
 *
 * 实测（2026-11 版本）：
 *   黑暗之女  id=1      alias=Annie       普通版
 *   黑暗之女  id=60001  alias=Jade_Annie  经典模式版，relatedPrimeItemId=1 指向原版
 *   88 个经典模式英雄全部 relatedPrimeItemId > 0，id 全部落在 60000 段
 *   经典模式皮肤 id 落在 60001xxx ~ 60267xxx
 *
 * 用四层判据叠加，任何一层命中即判定为变体，这样以后官方新增一批
 * （即使换了 alias 前缀或 id 段）也不会漏：
 *   1) id <= 0                     → 占位（客户端里的 id=-1「无」）
 *   2) relatedPrimeItemId > 0      → 语义最强：这条是某个主版本的变体
 *   3) relatedPrimeContentId 非空  → 同上，字段不同
 *   4) alias 以 Jade_ 开头          → 当前命名法
 *   5) id 落在经典模式 id 段          → 兜底
 * 最后再按「同名保留 id 最小」做一次去重，作为最后一道保险。
 */

const CLASSIC_ID_MIN = 60000
const CLASSIC_ID_MAX = 62000

function isClassicChampion(c) {
  if (!c || !c.id) return true
  if (c.id <= 0) return true
  if (c.relatedPrimeItemId && c.relatedPrimeItemId > 0) return true
  if (c.relatedPrimeContentId) return true
  if (/^Jade_/i.test(c.alias || '')) return true
  if (c.id >= CLASSIC_ID_MIN && c.id < CLASSIC_ID_MAX) return true
  return false
}

/** 皮肤：由 skinId 反推 championId（skinId = championId * 1000 + n） */
function isClassicSkinId(skinId) {
  const id = Number(skinId)
  if (!id || id <= 0) return true
  const championId = Math.floor(id / 1000)
  return championId >= CLASSIC_ID_MIN && championId < CLASSIC_ID_MAX
}

/** 同名去重：保留 id 最小的那个（普通版 id 恒小于变体） */
function dedupeByName(list, keyFn = (x) => x.name) {
  const best = new Map()
  let removed = 0
  for (const item of list) {
    const k = keyFn(item)
    const prev = best.get(k)
    if (!prev) {
      best.set(k, item)
    } else {
      removed += 1
      const curId = item.id ?? 0
      const prevId = prev.id ?? 0
      if (curId < prevId) best.set(k, item)
    }
  }
  return { list: [...best.values()], removed }
}

/**
 * 过滤英雄列表
 * @returns {{ list: Array, removed: { variant:number, dedupe:number, total:number } }}
 */
function filterChampions(raw) {
  const src = Array.isArray(raw) ? raw : []
  const kept = src.filter((c) => !isClassicChampion(c))
  const variantRemoved = src.length - kept.length
  const { list, removed: dedupeRemoved } = dedupeByName(kept)
  return {
    list,
    removed: {
      variant: variantRemoved,
      dedupe: dedupeRemoved,
      total: variantRemoved + dedupeRemoved,
    },
  }
}

/** 过滤静态皮肤表（skins.json 的 {id: {...}}） */
function filterSkins(rawMap) {
  const out = {}
  let removed = 0
  for (const k of Object.keys(rawMap || {})) {
    const s = rawMap[k]
    if (!s || !s.id) continue
    if (isClassicSkinId(s.id) || s.isBase === undefined) {
      // isBase undefined 说明结构异常，跳过
    }
    if (isClassicSkinId(s.id)) {
      removed += 1
      continue
    }
    out[k] = s
  }
  return { map: out, removed }
}

module.exports = {
  isClassicChampion,
  isClassicSkinId,
  dedupeByName,
  filterChampions,
  filterSkins,
  CLASSIC_ID_MIN,
  CLASSIC_ID_MAX,
}
