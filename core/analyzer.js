'use strict'
const releaseDb = require('./release')
/**
 * 清单解析 + 购买建议引擎
 * 输入：用户粘贴的清单文本（皮肤名 + 英雄名，任意顺序/分隔符）
 * 输出：分层推荐（S/A/B/C/D/skip），每条附可解释理由
 */

const PUNCT = /[\s\u3000:：·・\-—_/\\|,，、.。!！?？"'“”‘’()（）\[\]【】<>《》+*#]/g

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(PUNCT, '')
    .replace(/（\d{4}）/g, '')
}

/** 去掉每行常见的列表前缀： 1. / - / * / ① / √ */
function stripPrefix(line) {
  return line.replace(/^\s*(?:[-*•·]|\d+[.、)]|[①-⑳])\s*/, '').trim()
}

function buildIndex(catalog) {
  const byExact = new Map()
  const byChampion = new Map()
  const all = []
  for (const id of Object.keys(catalog.skins || {})) {
    const s = catalog.skins[id]
    if (s.isBase) continue
    const n = norm(s.name)
    if (!n) continue
    all.push(s)
    if (!byExact.has(n)) byExact.set(n, [])
    byExact.get(n).push(s)
    if (s.championId) {
      if (!byChampion.has(s.championId)) byChampion.set(s.championId, [])
      byChampion.get(s.championId).push(s)
    }
  }
  const champions = Object.values(catalog.champions || {}).map((c) => ({
    ...c,
    nName: norm(c.name),
    nAlias: norm(c.alias),
  }))
  return { byExact, byChampion, all, champions }
}

/** 找出文本里出现的英雄（长名优先，避免「阿狸」吃掉「阿狸的」之类） */
function championsInText(text, idx) {
  const nText = norm(text)
  const hits = []
  for (const c of idx.champions) {
    const keys = [c.nName, c.nAlias].filter((k) => k && k.length >= 2)
    for (const k of keys) {
      if (nText.includes(k)) {
        hits.push({ champion: c, key: k })
        break
      }
    }
  }
  return hits.sort((a, b) => b.key.length - a.key.length)
}

/**
 * 匹配单行
 * @returns { matches: [{skin, score, how}], unmatched: bool }
 */
function matchLine(line, idx, championSkinMap) {
  const text = stripPrefix(line)
  if (!text) return { matches: [], empty: true }
  const n = norm(text)
  if (!n) return { matches: [], empty: true }

  // 1) 全名精确
  if (idx.byExact.has(n)) {
    return {
      matches: idx.byExact.get(n).map((s) => ({ skin: s, score: 1, how: 'exact' })),
    }
  }

  // 2) 英雄 + 皮肤名互相包含
  const champHits = championsInText(text, idx)
  const pool = []
  for (const h of champHits) {
    const list = championSkinMap(h.champion.id)
    for (const s of list) pool.push(s)
  }
  const searchPool = pool.length ? pool : idx.all

  const scored = []
  for (const s of searchPool) {
    const ns = norm(s.name)
    if (!ns) continue
    if (ns === n) {
      scored.push({ skin: s, score: 1, how: 'exact' })
      continue
    }
    if (ns.includes(n) || n.includes(ns)) {
      const ratio = Math.min(ns.length, n.length) / Math.max(ns.length, n.length)
      scored.push({ skin: s, score: 0.6 + 0.35 * ratio, how: 'contains' })
      continue
    }
    // 3) 去英雄名后的关键词匹配（"星守阿狸" → "星守"）
    let rest = n
    for (const c of idx.champions) {
      const k = c.nName
      if (k && rest.includes(k)) rest = rest.replace(k, '')
    }
    if (rest.length >= 2 && norm(s.name).includes(rest)) {
      scored.push({ skin: s, score: 0.5 + 0.2 * (rest.length / n.length), how: 'keyword' })
    }
  }
  scored.sort((a, b) => b.score - a.score || b.skin.rarityRank - a.skin.rarityRank)
  const best = scored[0]
  return { matches: best ? scored.filter((x) => x.score >= best.score - 0.05).slice(0, 4) : [] }
}

/** 供产出「为什么推荐」的常用度描述 */
function usageText(u) {
  if (!u) return ''
  const parts = []
  if (u.masteryLevel) parts.push(`成就 ${u.masteryLevel} 级`)
  if (u.games) parts.push(`近 ${u.games} 场里出现 ${u.games} 次`)
  if (u.recent30 && u.recent30 !== u.games) parts.push(`近 30 天 ${u.recent30} 场`)
  if (!parts.length) return ''
  return `你最常玩的英雄之一（${parts.join('，')}）`
}

/** 当前版本强度描述（OP.GG 梯度） */
function statsText(st) {
  if (!st || st.tier == null) return ''
  const modeLabel = st.mode === 'aram' ? '大乱斗' : '排位'
  const wr = st.winRate != null ? `，胜率 ${st.winRate}%` : ''
  return `${modeLabel} T${st.tier}${wr}`
}

/** 单条皮肤的推荐分层 */
function classify(skin, champion, price, usage, stats) {
  const ownedSkins = (champion.skins || []).filter((s) => !s.isBase && s.owned)
  const ownedCount = ownedSkins.length
  const maxRank = champion.maxOwnedRarityRank || 0
  const maxLabel = champion.maxOwnedRarityLabel || '无'
  const u = usage || null
  const st = stats || null
  const base = {
    skinId: skin.id,
    skinName: skin.name,
    championId: skin.championId,
    championName: champion.name,
    championOwned: !!champion.owned,
    rarity: skin.rarity,
    rarityLabel: skin.rarityLabel,
    rarityRank: skin.rarityRank,
    legacy: skin.legacy,
    lines: skin.lines,
    tilePath: skin.tilePath,
    releaseLabel: ((releaseDb.getRelease(skin.id) || {}).release) || null,
    releaseAt: ((releaseDb.getRelease(skin.id) || {}).releaseAt) || 0,
    owned: !!skin.owned,
    ownedSkinCount: ownedCount,
    maxOwnedRarityLabel: maxLabel,
    maxOwnedRarityRank: maxRank,
    usage: u
      ? {
          rank: u.rank,
          score: u.score,
          masteryLevel: u.masteryLevel,
          masteryPoints: u.masteryPoints,
          games: u.games,
          recent30: u.recent30,
          winRate: u.winRate,
          lastPlayed: u.lastPlayed,
        }
      : null,
    price: price || null,
  }

  if (skin.owned) {
    return {
      ...base,
      tier: 'skip',
      tierLabel: '已拥有',
      reason: '这件你已经有，不用重复购买',
      suggestion: '跳过',
    }
  }

  const noChampion = !champion.owned
  const discount = (price && price.discountPct) || 0

  const uText = usageText(u)
  const stText = statsText(st)

  if (ownedCount === 0) {
    return {
      ...base,
      tier: 'S',
      tierLabel: '零皮肤英雄',
      reason:
        (noChampion
          ? `该英雄你还没有，皮肤需先解锁英雄才能使用`
          : `${champion.name} 目前一件皮肤都没有，这件直接补齐空缺`) +
        (uText ? ` · ${uText}` : '') +
        (stText ? ` · ${stText}` : ''),
      suggestion: '优先买',
    }
  }
  if (skin.rarityRank > maxRank) {
    return {
      ...base,
      tier: 'A',
      tierLabel: '等级升级',
      reason:
        `${skin.rarityLabel} > 你现有最高档 ${maxLabel}，属于明显升级` +
        (uText ? ` · ${uText}` : '') +
        (stText ? ` · ${stText}` : ''),
      suggestion: '值得买',
    }
  }
  if (skin.rarityRank === maxRank && discount >= 40) {
    return {
      ...base,
      tier: 'B',
      tierLabel: '同档但折扣大',
      reason: `与你最高档同为 ${skin.rarityLabel}，但当前折扣 ${discount}%`,
      suggestion: '看折扣可买',
    }
  }
  if (skin.rarityRank === maxRank) {
    return {
      ...base,
      tier: 'C',
      tierLabel: '同档补收藏',
      reason: `与你已有最高档（${maxLabel}）同级，属于收藏向`,
      suggestion: '可选',
    }
  }
  return {
    ...base,
    tier: 'D',
    tierLabel: '不高于现有',
    reason: `等级（${skin.rarityLabel}）低于你已有的 ${maxLabel}，优先级低`,
    suggestion: '不建议',
  }
}

const TIER_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4, skip: 5 }

/**
 * 主入口
 * @param {string} text 清单原文
 * @param {object} collection getCollection() 结果
 * @param {object} catalog catalog.load() 结果
 * @param {object} prices { [skinId]: {...} } 可选
 */
function analyze(text, collection, catalog, prices = {}, usage = null, stats = null) {
  const idx = buildIndex(catalog)
  const champMap = new Map((collection.champions || []).map((c) => [c.id, c]))
  const usageMap = (usage && usage.byChampion) || {}
  const statsMap = (stats && stats.byChampion) || {}
  const statsMode = (stats && stats.mode) || 'ranked'
  const championSkinMap = (champId) => {
    const champ = champMap.get(champId)
    if (champ) return champ.skins.filter((s) => !s.isBase)
    return (idx.byChampion.get(champId) || []).map((s) => ({ ...s, owned: false }))
  }

  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const items = []
  const unresolved = []
  const seen = new Set()

  // ① 优先用「实体提取」：支持单行多皮肤、无空格、简写、OCR 丢空格等情况
  const preFound = extractSkinNames(text, catalog, collection.champions)
  for (const skinMeta of preFound) {
    if (seen.has(skinMeta.id)) continue
    seen.add(skinMeta.id)
    const champ = champMap.get(skinMeta.championId)
    if (!champ) continue
    const mine = champ.skins.find((s) => s.id === skinMeta.id)
    const skin = { ...skinMeta, owned: !!(mine && mine.owned) }
    const merged = { ...champ, skins: champ.skins.length ? champ.skins : championSkinMap(champ.id) }
    const st0 = statsMap[skin.championId]
    const stSlot0 = st0 && st0[statsMode] ? { ...st0[statsMode], mode: statsMode } : null
    const item0 = classify(skin, merged, prices[skin.id] || null, usageMap[skin.championId] || null, stSlot0)
    item0.input = skinMeta.name
    item0.matchScore = 1
    item0.matchHow = 'entity'
    items.push(item0)
  }

  // ② 实体提取没结果时，退回逐行匹配
  if (!items.length) for (const line of lines) {
    const r = matchLine(line, idx, championSkinMap)
    if (r.empty) continue
    if (!r.matches.length) {
      unresolved.push({ raw: line, reason: '没有匹配到任何皮肤' })
      continue
    }
    const best = r.matches[0]
    const skinMeta = best.skin
    if (seen.has(skinMeta.id)) continue
    seen.add(skinMeta.id)
    const champ = champMap.get(skinMeta.championId)
    if (!champ) {
      unresolved.push({ raw: line, reason: '匹配到皮肤但英雄数据缺失' })
      continue
    }
    // 关键：匹配用的是静态 catalog（没有 owned），必须用账号藏品里的同 id 皮肤覆盖拥有状态
    const mine = champ.skins.find((s) => s.id === skinMeta.id)
    const skin = { ...skinMeta, owned: !!(mine && mine.owned) }
    const merged = { ...champ, skins: champ.skins.length ? champ.skins : championSkinMap(champ.id) }
    const st = statsMap[skin.championId]
    const stSlot = st && st[statsMode] ? { ...st[statsMode], mode: statsMode } : null
    const item = classify(skin, merged, prices[skin.id] || null, usageMap[skin.championId] || null, stSlot)
    item.input = line
    item.matchScore = Number(best.score.toFixed(2))
    item.matchHow = best.how
    item.alternatives = r.matches.slice(1).map((m) => ({ id: m.skin.id, name: m.skin.name }))
    items.push(item)
  }

  items.sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      (b.usage ? b.usage.score : 0) - (a.usage ? a.usage.score : 0) ||
      b.rarityRank - a.rarityRank ||
      (b.price?.discountPct || 0) - (a.price?.discountPct || 0)
  )

  const groups = { S: [], A: [], B: [], C: [], D: [], skip: [] }
  for (const it of items) groups[it.tier].push(it)

  const totalPrice = items
    .filter((i) => i.tier !== 'skip' && i.price && i.price.rp)
    .reduce((s, i) => s + i.price.rp, 0)

  return {
    items,
    groups,
    unresolved,
    summary: {
      inputLines: lines.length,
      matched: items.length,
      unresolved: unresolved.length,
      byTier: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
      totalPrice,
      hasPrice: Object.keys(prices).length > 0,
      hasUsage: !!(usage && usage.available),
      championLevel: [...new Set(items.map((i) => i.championId))].length,
    },
  }
}

module.exports = { analyze, classify, norm, stripPrefix }

/**
 * 从一段文本里提取所有已知皮肤名（最长优先，不重叠）
 * 解决「一行里写了多个皮肤」的场景，比如 "山海绘卷 科加斯  逆命 塔里克"
 * @returns {Array<object>} catalog 里的皮肤对象
 */
/**
 * 从文本里提取皮肤（宁多勿少）
 *
 * 规则（用户定的）：
 *   1. 除空格外的特殊符号（；;，,、|/ 等）视为分隔符，拆成多段分别匹配
 *   2. 每段先精确匹配，再按「词全部包含」模糊匹配（如「神龙尊者 亚索」→「神龙尊者 昼日真龙 亚索」）
 *   3. 都没命中时，检测段内的英雄名，把该英雄的皮肤都带上（至少不遗漏）
 *
 * @returns {Array<object>} catalog 里的皮肤对象（已去重）
 */
function extractSkinNames(text, catalog, champions) {
  const src = String(text || '').trim()
  if (!src) return []

  const list = Object.values((catalog && catalog.skins) || {})
    .filter((s) => s && !s.isBase && s.name)
    .sort((a, b) => a.name.length - b.name.length) // 短名优先，避免被长名吃掉
  const champs = Array.isArray(champions) ? champions : []
  const byId = new Map(champs.map((c) => [c.id, c]))

  // 皮肤名的最后一个词基本就是英雄本名（如「神龙尊者 昼日真龙 亚索」→「亚索」），
  // 而 champion.name 是称号（「疾风剑豪」），所以用它建一份本名索引
  const nameKeyToChamp = new Map()
  for (const s of list) {
    const parts = String(s.name).split(/\s+/).filter(Boolean)
    const last = parts[parts.length - 1]
    if (last && last.length >= 2 && !nameKeyToChamp.has(last)) nameKeyToChamp.set(last, s.championId)
  }

  const out = []
  const seen = new Set()
  const push = (s) => {
    if (!s || seen.has(s.id)) return
    seen.add(s.id)
    const c = byId.get(s.championId)
    out.push({ ...s, championName: (c && c.name) || s.championName || '' })
  }

  // 1) 按「除空格外的特殊符号」拆段
  const segs = src
    .split(/[；;，,、|｜/\\·・•\-—_~～`"'“”‘’()（）【】\[\]{}<>《》!！?？:：*&#@%+=\n\r\t]+/)
    .map((x) => x.trim())
    .filter(Boolean)

  const work = segs.length ? segs : [src]

  for (const seg of work) {
    // ① 段内滚动抽取「完整皮肤名」（长名优先），这是最高置信的命中
    //    同时做「去空格」比对——OCR 经常把皮肤名里的空格吃掉
    const squash = (v) => String(v || '').replace(/\s+/g, '')
    let rest = ' ' + seg + ' '
    let restSquashed = squash(seg)
    const longFirst = list.slice().sort((a, b) => b.name.length - a.name.length)
    for (const s of longFirst) {
      const nSquashed = squash(s.name)
      if (!nSquashed) continue
      if (rest.includes(s.name) || restSquashed.includes(nSquashed)) {
        push(s)
        rest = rest.split(s.name).join('\u0000')
        restSquashed = restSquashed.split(nSquashed).join('\u0000')
      }
    }
    // 两个版本都要判断：去空格版本为空说明已全部命中，不该继续模糊匹配
    const leftSquashed = restSquashed.replace(/\u0000/g, '').trim()
    if (!leftSquashed) continue
    const left = leftSquashed // 统一用去空格版本，避免重复兜底

    // ② 剩余部分：词全包含（「神龙尊者 亚索」→ 神龙尊者的亚索皮肤）
    const words = left.split(/\s+/).filter((w) => w.length >= 2)
    if (words.length) {
      const hits = list.filter((s) => words.every((w) => s.name.includes(w)))
      if (hits.length) {
        hits.forEach(push)
        continue
      }
    }

    // ③ 剩余部分里检测英雄本名/称号 → 只取该英雄最近上线的 2 款，避免一次带出十几款
    const hitIds = new Set()
    for (const [key, cid] of nameKeyToChamp) {
      if (key.length >= 2 && left.includes(key)) hitIds.add(cid)
    }
    for (const c of champs) {
      if (c.name && c.name.length >= 2 && left.includes(c.name)) hitIds.add(c.id)
    }
    if (hitIds.size) {
      for (const cid of hitIds) {
        const all = list.filter((s) => s.championId === cid)
        // 优先挑「名字里含 left 关键词」的（「神龙尊者亚索」→ 神龙尊者系列的亚索皮肤）
        const preferred = all.filter((s) => {
          for (let i = 0; i + 3 <= left.length; i++) {
            if (s.name.includes(left.slice(i, i + 3))) return true
          }
          return false
        })
        const pool = preferred.length ? preferred : all
        pool
          .slice()
          .sort((a, b) => (b.releaseAt || 0) - (a.releaseAt || 0))
          .slice(0, preferred.length ? 4 : 2)
          .forEach(push)
      }
      continue
    }

    // ④ 最后再放宽：按连续 4 字片段模糊命中，最多取 3 款
    if (left.length >= 4) {
      const loose = list
        .filter((s) => {
          for (let i = 0; i + 4 <= left.length; i++) {
            if (s.name.includes(left.slice(i, i + 4))) return true
          }
          return false
        })
        .slice(0, 3)
      loose.forEach(push)
    }
  }
  // 特殊场景：没有分隔符但文本里出现了多个英雄名 → 保证每个英雄至少一款
  const namedChamps = champs.filter((c) => c.name && src.includes(c.name))
  if (namedChamps.length > 1) {
    for (const c of namedChamps) {
      if (out.some((s) => s.championId === c.id)) continue
      const cand = list.filter((s) => s.championId === c.id)
      if (cand.length) push(cand[cand.length - 1])
    }
  }

  return out
}
module.exports.extractSkinNames = extractSkinNames
