'use strict'
/**
 * 【可选模块】商城在售与价格
 * 国服 /lol-store/* 有时由腾讯后端接管，返回空数组或 404。
 * 因此本模块只做「探测 + 尽力而为」，拿不到就退回「无价格模式」，不影响推荐主体。
 */
const { lcuRequest } = require('./api')

const ENDPOINTS = [
  { key: 'sales', label: '限时折扣清单', path: '/lol-store/v1/catalog/sales' },
  { key: 'catalog', label: '全量商城目录', path: '/lol-store/v1/catalog' },
  { key: 'storeUrl', label: '商城地址', path: '/lol-store/v1/getStoreUrl' },
]

function pickPrice(prices) {
  if (!Array.isArray(prices) || !prices.length) return null
  const rp = prices.find((p) => /rp|tencent|coin/i.test(p.currency || '')) || prices[0]
  return rp ? { currency: rp.currency, cost: rp.cost, discount: rp.discount ?? null } : null
}

/** 把 catalog item 归一成统一价格对象 */
function normalizeItem(item) {
  const base = pickPrice(item.prices)
  const salePrice = item.sale ? pickPrice(item.sale.prices) : null
  const original = base ? base.cost : null
  const now = salePrice ? salePrice.cost : original
  let pct = 0
  // 小数折扣字段（0.4 = 打 6 折）与价格差两种口径都兼容
  const rawDiscount = (salePrice && salePrice.discount) ?? (base && base.discount) ?? null
  if (typeof rawDiscount === 'number' && rawDiscount > 0 && rawDiscount < 1) {
    pct = Math.round(rawDiscount * 100)
  } else if (original && now && original > now) {
    pct = Math.round((1 - now / original) * 100)
  }
  const loc = Array.isArray(item.localizations)
    ? item.localizations.find((l) => /zh/i.test(l.language || '')) || item.localizations[0]
    : null
  return {
    skinId: item.itemId,
    name: loc ? loc.name : '',
    originalRp: original,
    rp: now,
    discountPct: pct,
    onSale: !!(item.sale && item.sale.endDate),
    saleStart: item.sale ? item.sale.startDate : null,
    saleEnd: item.sale ? item.sale.endDate : null,
    active: item.active !== false,
    releaseDate: item.releaseDate || null,
    currency: (base && base.currency) || 'RP',
    // 国服把神话精萃/抽奖类皮肤也挂在 RP 字段上，用离谱占位价（如 99999）标记不可点券直购
    nonRp: !!(now && now >= 50000),
  }
}

/** 能力探测：决定 UI 上价格模块的开关状态 */
async function probe(conn) {
  const results = []
  for (const ep of ENDPOINTS) {
    const r = await lcuRequest(conn, ep.path, { timeout: 8000 })
    let count = null
    if (r.status === 200) {
      if (Array.isArray(r.json)) count = r.json.length
      else if (r.json && Array.isArray(r.json.catalog)) count = r.json.catalog.length
      else if (typeof r.json === 'string') count = 1
      else if (r.json) count = 1
    }
    results.push({ ...ep, status: r.status, count, ok: r.status === 200 })
  }
  const salesOk = results.find((x) => x.key === 'sales')
  const catalogOk = results.find((x) => x.key === 'catalog')
  const available = !!((salesOk && salesOk.ok) || (catalogOk && catalogOk.ok && catalogOk.count > 0))
  return {
    available,
    salesCount: (salesOk && salesOk.count) || 0,
    catalogCount: (catalogOk && catalogOk.count) || 0,
    endpoints: results,
    probedAt: Date.now(),
    note: available
      ? '商城接口可用，价格与折扣自动填入'
      : '本区服商城接口无数据，已退回无价格模式（可手动导入价格）',
  }
}

/** 拉全量皮肤价格表（失败返回空对象）
 *  实测：/lol-store/v1/catalog 不带参数返回全量目录（含 CHAMPION_SKIN），
 *  带 ?inventoryType= 会被 RPC 层以 "not a collection" 拒绝 —— 所以在本地过滤。
 */
let _priceCache = { at: 0, map: null }
const PRICE_TTL = 5 * 60 * 1000

async function fetchPrices(conn, { skinIds = null, force = false } = {}) {
  // /lol-store/v1/catalog 一次要 3.5 秒，缓存复用
  if (!force && _priceCache.map && Date.now() - _priceCache.at < PRICE_TTL) {
    if (!Array.isArray(skinIds)) return _priceCache.map
    const out = {}
    for (const id of skinIds) if (_priceCache.map[id]) out[id] = _priceCache.map[id]
    return out
  }
  const map = {}
  const r = await lcuRequest(conn, '/lol-store/v1/catalog', { timeout: 45000 })
  if (r.status === 200) {
    const items = Array.isArray(r.json) ? r.json : (r.json && r.json.catalog) || []
    for (const it of items) {
      if (!it || it.inventoryType !== 'CHAMPION_SKIN') continue
      const n = normalizeItem(it)
      if (n.skinId) map[n.skinId] = n
    }
  }
  // 单品兜底（catalog 不给时逐条查，这个端点实测最完整：原价 + 折扣率 + 中文名）
  if (!Object.keys(map).length && Array.isArray(skinIds)) {
    const queue = [...skinIds].slice(0, 400)
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const id = queue.shift()
        const one = await lcuRequest(conn, `/lol-store/v1/skins/${id}`, { timeout: 8000 })
        if (one.status === 200 && one.json && one.json.itemId) {
          map[id] = normalizeItem(one.json)
        }
      }
    })
    await Promise.all(workers)
  }
  if (Object.keys(map).length) _priceCache = { at: Date.now(), map }
  return map
}

/** 限时折扣批次（含起止时间） */
async function fetchSales(conn) {
  const r = await lcuRequest(conn, '/lol-store/v1/catalog/sales', { timeout: 15000 })
  if (r.status !== 200 || !Array.isArray(r.json)) return []
  return r.json
    .map((s) => {
      if (!s || !s.item || s.item.inventoryType !== 'CHAMPION_SKIN') return null
      const pr = pickPrice(s.sale && s.sale.prices)
      return {
        skinId: s.item.itemId,
        startDate: s.sale ? s.sale.startDate : null,
        endDate: s.sale ? s.sale.endDate : null,
        saleRp: pr ? pr.cost : null,
        active: !!s.active,
      }
    })
    .filter(Boolean)
}

module.exports = { probe, fetchPrices, fetchSales, normalizeItem }
