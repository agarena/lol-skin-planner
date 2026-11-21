'use strict'
/**
 * 国服活动折扣（神话半价 / 全场半价）
 *
 * 数据来自 `data/act-sale.json`，由 tools/parse_act.js 从腾讯活动页解析而来：
 *   https://lol.qq.com/act/a20261115champion/page2.html → js/data.js
 *   其中 window.skinSaleData2 是「神话级皮肤限时半价」（30 条，含 yj 原价 / price 折后）
 *        window.skinSaleData1 是「全场半价」（722 条点券价）
 *
 * 为什么必须走活动页：这批商品不在 LCU 的 /lol-store/v1/skins 里，
 * getStoreUrl 返回的 SGP 地址直接 403，国际服数据源也没有国服活动。
 *
 * 兜底：如果 act-sale.json 不存在，回退读 data/mythic-sale.json（人工录入）。
 */
const fs = require('node:fs')
const path = require('node:path')

const ACT_FILE = path.join(__dirname, '..', 'data', 'act-sale.json')
const MANUAL_FILE = path.join(__dirname, '..', 'data', 'mythic-sale.json')

let cache = null

function build() {
  const skins = {}
  let meta = { source: null, updatedAt: null, endDate: null, note: null, currency: '神话精萃' }

  // 1) 活动页数据（优先）
  try {
    const act = JSON.parse(fs.readFileSync(ACT_FILE, 'utf8').replace(/^\uFEFF/, ''))
    for (const it of (act.mythicSale && act.mythicSale.items) || []) {
      if (!it.skinId) continue
      const original = it.original
      const price = it.price
      const pct = original && price && original > price ? Math.round((1 - price / original) * 100) : 0
      skins[it.skinId] = {
        name: it.name,
        price,
        regular: original,
        discountPct: pct,
        currency: '神话精萃',
        kind: 'mythic',
      }
    }
    // 点券半价也收进来，UI 可以复用
    for (const it of (act.rpSale && act.rpSale.items) || []) {
      if (!it.skinId || skins[it.skinId]) continue
      const original = it.original
      const price = it.price
      const pct = original && price && original > price ? Math.round((1 - price / original) * 100) : 0
      skins[it.skinId] = {
        name: it.name,
        price,
        regular: original,
        discountPct: pct,
        currency: 'RP',
        kind: 'rp',
      }
    }
    meta = {
      source: act.source,
      actId: act.actId,
      note: act.note,
      updatedAt: act.fetchedAt,
      endDate: act.endDate || null,
      currency: '神话精萃',
    }
  } catch {
    /* 没有活动数据 */
  }

  // 2) 人工录入兜底
  if (Object.keys(skins).length === 0) {
    try {
      const man = JSON.parse(fs.readFileSync(MANUAL_FILE, 'utf8').replace(/^\uFEFF/, ''))
      for (const [id, s] of Object.entries(man.skins || {})) {
        skins[id] = {
          name: s.name,
          price: s.price,
          regular: s.regular,
          discountPct: s.discountPct,
          currency: man.currency || '神话精萃',
          kind: 'mythic',
        }
      }
      meta = {
        source: man.source,
        note: man.note,
        updatedAt: man.updatedAt,
        endDate: man.endDate || null,
        currency: man.currency || '神话精萃',
      }
    } catch {
      /* 什么都没有 */
    }
  }

  return { skins, meta }
}

function load() {
  if (!cache) cache = build()
  return cache
}

/** @returns {{price:number, regular:number, discountPct:number, currency:string, kind:string}|null} */
function getSale(skinId) {
  const c = load()
  const s = c.skins[Number(skinId)]
  if (!s) return null
  return { ...s }
}

function meta() {
  const c = load()
  return { ...c.meta, count: Object.keys(c.skins).length }
}

module.exports = { load, getSale, meta, ACT_FILE, MANUAL_FILE }
