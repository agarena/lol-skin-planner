'use strict'
/**
 * 皮肤人气榜（本地数据文件）
 *
 * data/popular-skins.json 由 tools/fetch_popular.js 生成，
 * 来源 lolskins.io/popular，指标是 SkinSpotlights 的 YouTube 播放量。
 * 这是目前能找到的、覆盖最广的客观「皮肤受欢迎程度」代理指标，
 * 用来给「高质量 / 高性价比」提供第三方依据，而不是我们主观打分。
 */
const fs = require('node:fs')
const path = require('node:path')

const FILE = path.join(__dirname, '..', 'data', 'popular-skins.json')
let cache = null

function load() {
  if (cache) return cache
  let raw = { items: [], source: null, fetchedAt: null }
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    /* 文件不存在时静默降级 */
  }
  const map = new Map()
  for (const it of raw.items || []) map.set(Number(it.skinId), it)
  cache = { ...raw, map }
  return cache
}

/** @returns {{rank:number, views:string, viewsNum:number}|null} */
function getPopularity(skinId) {
  const c = load()
  const it = c.map.get(Number(skinId))
  if (!it) return null
  return { rank: it.rank, views: it.views, viewsNum: it.viewsNum }
}

function meta() {
  const c = load()
  return { source: c.source, sourceUrl: c.sourceUrl, metric: c.metric, count: c.count, fetchedAt: c.fetchedAt }
}

module.exports = { load, getPopularity, meta, FILE }
