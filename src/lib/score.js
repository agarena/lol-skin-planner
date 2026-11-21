/**
 * 皮肤评分（共享模块）
 *
 * 八项构成：
 *   ① 稀有度    普通2 稀有6 史诗10 传说18 终极30 神话100 卓越300 圣堂1000
 *              减去「该英雄所有已拥有皮肤各自档位 × 50%」
 *   ② 售价      原价 ÷ 100（每 100 点券 1 分）
 *   ③ 限定      +20
 *   ④ 臻彩      每个 +100
 *   ⑤ 炫彩      每个 +10
 *   ⑥ 零皮肤    该英雄一件皮肤都没有时 +100
 *   ⑦ 荣耀      分段累加：1-5 ×1，6-10 ×2，11-20 ×3，21-30 ×4，31+ ×5
 *   ⑧ 新鲜度    ≤2015 = 5；2016-2020 = 10；2021 起 15 + (年-2021)×5
 */

export const RARITY_PTS = {
  kNoRarity: 2,
  kRare: 6,
  kEpic: 10,
  kLegendary: 18,
  kUltimate: 30,
  kMythic: 100,
  kExalted: 300,
  kTranscendent: 1000,
}

export function masteryScore(lv) {
  if (!lv || lv <= 0) return 0
  let s = 0
  s += Math.min(lv, 5) * 1
  if (lv > 5) s += Math.min(lv - 5, 5) * 2
  if (lv > 10) s += Math.min(lv - 10, 10) * 3
  if (lv > 20) s += Math.min(lv - 20, 10) * 4
  if (lv > 30) s += (lv - 30) * 5
  return s
}

export function freshnessScore(releaseLabelOrAt) {
  let year = 0
  if (typeof releaseLabelOrAt === 'string') {
    const m = releaseLabelOrAt.match(/^(\d{4})/)
    if (m) year = Number(m[1])
  } else if (typeof releaseLabelOrAt === 'number' && releaseLabelOrAt > 0) {
    year = new Date(releaseLabelOrAt).getFullYear()
  }
  if (!year) return { val: 0, note: '无数据' }
  if (year <= 2015) return { val: 5, note: year + ' 年' }
  if (year <= 2020) return { val: 10, note: year + ' 年' }
  return { val: 15 + (year - 2021) * 5, note: year + ' 年' }
}

/**
 * 计算单个皮肤的分数
 * @param {object} it   皮肤（需含 rarity / price / legacy / releaseLabel）
 * @param {object} ctx  { ownedByRarity, chromaOwned, prestigeOwned, champSkinOwned, masteryLevel }
 */
export function scoreOf(it, ctx) {
  const parts = []

  // ① 稀有度
  const base = RARITY_PTS[it.rarity] != null ? RARITY_PTS[it.rarity] : 2
  const ownedByRarity = ctx.ownedByRarity || {}
  let penalty = 0
  const penParts = []
  for (const rk of Object.keys(ownedByRarity)) {
    const cnt = ownedByRarity[rk]
    const pts = RARITY_PTS[rk] != null ? RARITY_PTS[rk] : 2
    const sub = cnt * pts * 0.5
    if (sub) {
      penalty += sub
      penParts.push(`${cnt}×${pts}×50%`)
    }
  }
  parts.push({
    key: '稀有度',
    val: base - penalty,
    note: penalty ? `${base} − (${penParts.join(' + ')}) = ${base - penalty}` : `${base}`,
  })

  // ② 售价
  const origRp = (it.price && it.price.originalRp) || 0
  const price = Math.floor(origRp / 100)
  parts.push({ key: '售价', val: price, note: origRp + ' ÷ 100' })

  // ③ 限定
  parts.push({ key: '限定', val: it.legacy ? 20 : 0, note: it.legacy ? '+20' : '—' })

  // ④⑤ 臻彩 / 炫彩
  const pre = (ctx.prestigeOwned || 0) * 100
  const chr = (ctx.chromaOwned || 0) * 10
  parts.push({ key: '臻彩', val: pre, note: `${ctx.prestigeOwned || 0} × 100` })
  parts.push({ key: '炫彩', val: chr, note: `${ctx.chromaOwned || 0} × 10` })

  // ⑥ 零皮肤
  const empty = ctx.champSkinOwned === 0 ? 100 : 0
  parts.push({ key: '零皮肤', val: empty, note: empty ? '+100' : '—' })

  // ⑦ 荣耀
  parts.push({ key: '荣耀', val: masteryScore(ctx.masteryLevel), note: `LV.${ctx.masteryLevel || 0}` })

  // ⑧ 新鲜度
  const fresh = freshnessScore(it.releaseLabel || it.releaseAt)
  parts.push({ key: '新鲜度', val: fresh.val, note: fresh.note })

  const total = parts.reduce((s, p) => s + p.val, 0)
  return { total: Math.round(total), parts }
}

/**
 * 从藏品 / 战绩 / 梯度构建打分上下文
 * @returns {{byChamp, byTier, byChroma, byRarity}}
 */
export function buildCtxMap(collection, usage, stats) {
  const byChamp = {}
  const byTier = {}
  const byChroma = {}
  const byRarity = {}
  const usageMap = (usage && usage.byChampion) || {}
  const statsMap = (stats && stats.byChampion) || {}

  for (const c of (collection && collection.champions) || []) {
    const skins = (c.skins || []).filter((x) => !x.isBase)
    byChamp[c.id] = {
      skinOwned: c.ownedSkinCount || 0,
      skinTotal: skins.length,
      maxOwnedLabel: c.maxOwnedRarityLabel || '无',
      masteryLevel: (usageMap[c.id] && usageMap[c.id].masteryLevel) || 0,
    }
    const st = statsMap[c.id]
    byTier[c.id] = {
      ranked: st && st.ranked ? st.ranked.tier : null,
      aram: st && st.aram ? st.aram.tier : null,
    }

    byRarity[c.id] = {}
    for (const sk of skins) {
      if (sk.owned) byRarity[c.id][sk.rarity] = (byRarity[c.id][sk.rarity] || 0) + 1
    }

    for (const sk of skins) {
      const list = sk.chromaList || []
      if (!list.length) continue
      let co = 0
      let po = 0
      for (const x of list) {
        if (!x.owned) continue
        if (x.prestige) po += 1
        else co += 1
      }
      byChroma[sk.id] = {
        chromaOwned: co,
        chromaTotal: list.filter((x) => !x.prestige).length,
        prestigeOwned: po,
        prestigeTotal: list.filter((x) => x.prestige).length,
      }
    }
  }
  return { byChamp, byTier, byChroma, byRarity }
}

/** 给某个皮肤算分（自动从 ctxMap 取上下文） */
export function scoreSkin(skin, ctxMap) {
  const byChamp = (ctxMap && ctxMap.byChamp) || {}
  const byTier = (ctxMap && ctxMap.byTier) || {}
  const byChroma = (ctxMap && ctxMap.byChroma) || {}
  const byRarity = (ctxMap && ctxMap.byRarity) || {}
  const ci = byChamp[skin.championId] || {}
  const cm = byChroma[skin.id] || byChroma[skin.skinId] || {}
  const ti = byTier[skin.championId] || {}
  const ctx = {
    ownedByRarity: byRarity[skin.championId] || {},
    chromaOwned: cm.chromaOwned || 0,
    prestigeOwned: cm.prestigeOwned || 0,
    champSkinOwned: ci.skinOwned || 0,
    champSkinTotal: ci.skinTotal || 0,
    masteryLevel: ci.masteryLevel || 0,
    tierRanked: ti.ranked,
    tierAram: ti.aram,
  }
  return { ...scoreOf(skin, ctx), ctx }
}
