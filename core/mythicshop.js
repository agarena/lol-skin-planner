'use strict'
/**
 * 神话商店（Mythic Shop）轮换数据
 *
 * 为什么不能用 LCU：实测 10 个候选端点（/lol-mythic-shop/*、/lol-store/v1/mythic-shop、
 * /lol-cosmetics/* 等）全部 404/400 —— 神话商店是腾讯自家商城页，LCU 完全不暴露。
 *
 * 唯一可行来源：itemshop.gg 的公开 JSON API（无需 key，30 次/分钟）
 *   GET https://itemshop.gg/api/v1/shop/league-of-legends
 *   返回 sections：[Skin sale this week] / [Mythic Shop: featured] /
 *                  [Mythic Shop: biweekly] / [Limited-time bundles] / [Always in the store]
 *   item.id = "item:skin:131076" → 可以直接映射到本地 skinId，再用 catalog 取中文名
 *
 * 注意：这是第三方数据源，需要联网，且其条款要求展示时必须给出
 * "Data from itemshop.gg" 链接（见页面底部）。
 */
const https = require('node:https')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const catalog = require('./lcu/catalog')
const collection = require('./lcu/collection')

const API_URL = 'https://itemshop.gg/api/v1/shop/league-of-legends'
const CACHE_FILE = path.join(os.tmpdir(), 'lol-mythic-shop.json')
const CACHE_TTL = 30 * 60 * 1000
const ATTRIBUTION = { label: 'Data from itemshop.gg', url: 'https://itemshop.gg/league-of-legends' }

function fetchJson(url, timeout = 20000) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        timeout,
        headers: {
          'User-Agent': 'lol-skin-planner/0.1 (local desktop app)',
          Accept: 'application/json',
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, json, text: text.slice(0, 200) })
        })
      }
    )
    req.on('error', (e) => resolve({ status: 0, json: null, text: e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, json: null, text: 'timeout' })
    })
    req.end()
  })
}

function readCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8').replace(/^\uFEFF/, ''))
    if (j && j.at && Date.now() - j.at < CACHE_TTL && j.data) return j
  } catch {
    /* no cache */
  }
  return null
}

function writeCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ at: Date.now(), data }), 'utf8')
  } catch {
    /* ignore */
  }
}

/** "item:skin:131076" → 131076（其他类型返回 null） */
function skinIdOf(item) {
  const id = String((item && item.id) || '')
  const m = id.match(/^item:skin:(\d+)$/)
  return m ? Number(m[1]) : null
}

/**
 * 拉神话商店
 * @param {object} conn LCU 连接（用于取 catalog / 藏品做中文名和拥有状态）
 * @param {{force?:boolean}} opts
 */
async function getMythicShop(conn, { force = false } = {}) {
  let shop = null
  let fromCache = false

  if (!force) {
    const cached = readCache()
    if (cached) {
      shop = cached.data
      fromCache = true
    }
  }

  if (!shop) {
    const r = await fetchJson(API_URL)
    if (r.status !== 200 || !r.json || !r.json.data) {
      return {
        available: false,
        reason: `拉取 itemshop.gg 失败（HTTP ${r.status}）：${r.text || '无响应'}`,
        attribution: ATTRIBUTION,
        sections: [],
      }
    }
    shop = r.json.data
    writeCache(shop)
  }

  const cat = conn ? await catalog.load(conn).catch(() => null) : catalog.getCached()

  let ownedSet = new Set()
  if (conn) {
    try {
      const col = await collection.getCollection(conn)
      for (const c of col.champions) for (const s of c.skins) if (s.owned) ownedSet.add(s.id)
    } catch {
      /* 拿不到就不标 */
    }
  }

  const sections = []
  for (const sec of shop.sections || []) {
    const items = []
    for (const it of sec.items || []) {
      const skinId = skinIdOf(it)
      const meta = skinId && cat && cat.skins ? cat.skins[skinId] : null
      const price = it.price || {}
      items.push({
        skinId,
        // 优先用本地中文名；对不上时保留英文名
        name: (meta && meta.name) || it.name,
        englishName: it.name,
        type: it.type,
        category: it.category || null,
        rarity: it.rarity ? it.rarity.name : null,
        rarityLabel: meta ? meta.rarityLabel : it.rarity ? it.rarity.name : '',
        amount: price.amount != null ? price.amount : null,
        currency: price.currency || null,
        regular: price.regular != null ? price.regular : null,
        badge: it.badge || null,
        until: it.availability ? it.availability.until : null,
        untilLabel: it.availability ? it.availability.untilLabel : null,
        soldOut: !!it.soldOut,
        owned: skinId ? ownedSet.has(skinId) : false,
        image: it.images ? it.images.card : null,
        matched: !!meta,
      })
    }
    sections.push({
      title: sec.title,
      isMythic: /mythic/i.test(sec.title || ''),
      endsAt: sec.endsAt || null,
      upcoming: !!sec.upcoming,
      items,
    })
  }

  const mythicSections = sections.filter((s) => s.isMythic)
  const mythicItems = mythicSections.flatMap((s) => s.items)

  return {
    available: true,
    fromCache,
    shopDate: shop.shopDate || null,
    updatedAt: shop.updatedAt || null,
    expiresAt: shop.expiresAt || null,
    itemCount: shop.itemCount || 0,
    sections,
    mythic: {
      sections: mythicSections,
      total: mythicItems.length,
      unowned: mythicItems.filter((x) => !x.owned).length,
      matched: mythicItems.filter((x) => x.matched).length,
    },
    attribution: ATTRIBUTION,
    fetchedAt: Date.now(),
  }
}

module.exports = { getMythicShop, skinIdOf, API_URL, ATTRIBUTION }
