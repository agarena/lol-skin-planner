/**
 * 皮肤卡片统一数据源
 *
 * 皮肤页、方案页、英雄浮层必须共用这里的构建结果，
 * 不允许各页面自己拼 champInfo / chromaInfo / 商城字段。
 */

let storeCache = null
let storePending = null

/** 读取商城全量数据，进程内只拉一次；方案页和皮肤页拿到同一份 */
export function loadStoreItems() {
  if (storeCache) return Promise.resolve({ ok: true, data: storeCache })
  if (storePending) return storePending
  if (typeof window === 'undefined' || !window.lol || !window.lol.storeItems) {
    return Promise.resolve({ ok: false, error: '商城数据不可用' })
  }
  storePending = window.lol
    .storeItems({ view: 'all' })
    .then((r) => {
      storePending = null
      if (r && r.ok) {
        storeCache = r.data
        return { ok: true, data: storeCache }
      }
      return { ok: false, error: (r && r.error) || '读取商城失败' }
    })
    .catch((e) => {
      storePending = null
      return { ok: false, error: e.message || '读取商城失败' }
    })
  return storePending
}

/** 英雄维度信息：与皮肤页完全一致 */
export function buildChampInfoMap(collection, usage, stats) {
  const m = {}
  const usageMap = (usage && usage.byChampion) || {}
  const statsMap = (stats && stats.byChampion) || {}
  const owned = ((collection && collection.champions) || []).filter((c) => c.owned)
  const ranked = owned
    .filter((c) => usageMap[c.id] && usageMap[c.id].score)
    .sort((a, b) => (usageMap[b.id].score || 0) - (usageMap[a.id].score || 0))
  const topIds = new Set(ranked.slice(0, 20).map((c) => c.id))

  for (const c of (collection && collection.champions) || []) {
    const total = (c.skins || []).filter((s) => !s.isBase).length
    const u = usageMap[c.id]
    const st = statsMap[c.id]
    m[c.id] = {
      owned: !!c.owned,
      skinOwned: c.ownedSkinCount || 0,
      skinTotal: total,
      masteryLevel: u && u.masteryLevel ? u.masteryLevel : null,
      tierRanked: st && st.ranked ? st.ranked.tier : null,
      tierAram: st && st.aram ? st.aram.tier : null,
      maxOwnedRank: c.maxOwnedRarityRank || 0,
      maxOwnedLabel: c.maxOwnedRarityLabel || '无',
      frequent: topIds.has(c.id),
      hasSkin: (c.ownedSkinCount || 0) > 0,
    }
  }
  return m
}

/** 炫彩/臻彩拥有情况：与皮肤页完全一致 */
export function buildChromaMap(collection) {
  const m = {}
  for (const c of (collection && collection.champions) || []) {
    for (const s of c.skins || []) {
      if (s.isBase) continue
      const l = s.chromaList || []
      if (!l.length) continue
      let co = 0
      let po = 0
      for (const x of l) {
        if (!x.owned) continue
        if (x.prestige) po += 1
        else co += 1
      }
      m[s.id] = {
        chromaOwned: co,
        chromaTotal: l.filter((x) => !x.prestige).length,
        prestigeOwned: po,
        prestigeTotal: l.filter((x) => x.prestige).length,
      }
    }
  }
  return m
}

/** 商城条目按皮肤 id 建索引 */
export function buildStoreItemMap(storeData) {
  const m = new Map()
  for (const x of (storeData && storeData.items) || []) m.set(x.skinId, x)
  return m
}

/**
 * 同一张皮肤统一成皮肤页卡片使用的对象。
 * 以商城条目为准补全价格/折扣/限时字段，藏品数据保留炫彩等。
 */
export function toSkinCardSkin(skin, storeItem) {
  if (!skin) return null
  const merged = storeItem ? { ...skin, ...storeItem } : { ...skin }
  const skinId = merged.skinId != null ? merged.skinId : merged.id
  const name = merged.name != null ? merged.name : merged.skinName
  const rp = merged.rp != null ? merged.rp : merged.price && merged.price.rp
  const originalRp = merged.originalRp != null ? merged.originalRp : merged.price && merged.price.originalRp
  return {
    ...merged,
    skinId,
    name,
    rp,
    originalRp,
    price: merged.price || { rp, originalRp },
  }
}
