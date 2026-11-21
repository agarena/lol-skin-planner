'use strict'
/**
 * 抓取 lolskins.io 的人气榜 → data/popular-skins.json
 *
 * 数据来源：https://lolskins.io/popular/
 *   排序依据是 SkinSpotlights 的 YouTube 播放量（各皮肤 spotlight 视频播放数汇总），
 *   是目前能找到的、覆盖面最广的客观「皮肤热度」代理指标。
 *
 * 映射方式：榜单链接是 /champion/{Alias}/skin/{skinIndex}
 *   而 LCU 里 skinId = championId * 1000 + skinIndex
 *   例：/champion/Lux/skin/7 → Lux=99 → 99007（大元素使 拉克丝，榜单第 1）
 *
 * 用法：node tools/fetch_popular.js [--html <已保存的页面>]
 *   不带参数时会现抓（需要联网）
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const OUT = path.join(__dirname, '..', 'data', 'popular-skins.json')
const URL_ = 'https://lolskins.io/popular/'
const RARITY_RE = /\b(Ultimate|Legendary|Epic|Mythic|Rare|Transcendent|Exalted)\b/

function fetchPage() {
  return new Promise((resolve, reject) => {
    const u = new URL(URL_)
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname,
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) lol-skin-planner/0.1',
          Accept: 'text/html',
        },
      },
      (res) => {
        const c = []
        res.on('data', (d) => c.push(d))
        res.on('end', () => resolve(Buffer.concat(c).toString('utf8')))
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.end()
  })
}

/** 从 HTML 里按出现顺序提取 排名 / alias / skinIndex / 播放量 / 稀有度 */
function parseHtml(html) {
  const re = /\/champion\/([A-Za-z]+)\/skin\/(\d+)\//g
  const hits = []
  let m
  while ((m = re.exec(html))) {
    hits.push({ alias: m[1], skinIndex: Number(m[2]), at: m.index })
  }

  // 每个条目后面的片段里找播放量（如 6.8M）和稀有度
  const items = []
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    const start = h.at
    const end = i + 1 < hits.length ? hits[i + 1].at : Math.min(start + 4000, html.length)
    const seg = html.slice(start, end)
    const views = (seg.match(/(\d+(?:\.\d+)?[KM])\b/) || [])[1] || null
    const rarity = (seg.match(RARITY_RE) || [])[1] || null
    const year = (seg.match(/\b(20\d{2})\b/) || [])[1] || null
    // 排名就是出现顺序
    items.push({
      rank: i + 1,
      alias: h.alias,
      skinIndex: h.skinIndex,
      views,
      viewsNum: views ? toNumber(views) : null,
      rarity,
      year: year ? Number(year) : null,
    })
  }
  return items
}

function toNumber(s) {
  const m = String(s).match(/(\d+(?:\.\d+)?)([KM])/)
  if (!m) return null
  const n = Number(m[1])
  return m[2] === 'M' ? Math.round(n * 1e6) : Math.round(n * 1e3)
}

/** 用 LCU 的 champion-summary 把 alias 映射成 championId */
function fetchChampionSummary() {
  return new Promise((resolve) => {
    const connFile = path.join(process.env.TEMP || '/tmp', 'lol-lcu-conn-cache.json')
    let conn = null
    try {
      conn = JSON.parse(fs.readFileSync(connFile, 'utf8').replace(/^\uFEFF/, ''))
    } catch {
      return resolve(null)
    }
    const req = https.request(
      {
        host: '127.0.0.1',
        port: conn.port,
        path: '/lol-game-data/assets/v1/champion-summary.json',
        timeout: 30000,
        headers: {
          Authorization: 'Basic ' + Buffer.from(`riot:${conn.token}`).toString('base64'),
          Accept: 'application/json',
        },
        rejectUnauthorized: false,
      },
      (res) => {
        const c = []
        res.on('data', (d) => c.push(d))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(c).toString('utf8')))
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

async function main() {
  const htmlArgIdx = process.argv.indexOf('--html')
  let html
  if (htmlArgIdx > -1) {
    html = fs.readFileSync(process.argv[htmlArgIdx + 1], 'utf8')
  } else {
    console.log('抓取', URL_)
    html = await fetchPage()
  }

  const parsed = parseHtml(html)
  console.log(`解析到 ${parsed.length} 条`)

  const summary = await fetchChampionSummary()
  const byAlias = new Map()
  if (summary) {
    for (const c of summary) {
      if (!c || !c.alias) continue
      if (c.id <= 0 || c.id >= 60000) continue
      byAlias.set(String(c.alias).toLowerCase(), c.id)
    }
    console.log(`英雄别名映射表 ${byAlias.size} 条（来自本地 LCU）`)
  } else {
    console.log('⚠ 拿不到 LCU 英雄表，只能输出 alias，无法生成 skinId')
  }

  const items = []
  let unmapped = 0
  for (const p of parsed) {
    const championId = byAlias.get(p.alias.toLowerCase())
    if (!championId) {
      unmapped += 1
      continue
    }
    items.push({
      skinId: championId * 1000 + p.skinIndex,
      championId,
      alias: p.alias,
      skinIndex: p.skinIndex,
      rank: p.rank,
      views: p.views,
      viewsNum: p.viewsNum,
      rarity: p.rarity,
      year: p.year,
    })
  }

  const payload = {
    source: 'lolskins.io/popular',
    sourceUrl: URL_,
    metric: 'SkinSpotlights YouTube 播放量（各皮肤 spotlights 汇总）',
    fetchedAt: new Date().toISOString(),
    count: items.length,
    unmapped,
    items,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8')
  console.log(`写出 ${OUT}：${items.length} 条，未映射 ${unmapped}`)
  items.slice(0, 5).forEach((x) => console.log(`  #${x.rank} skinId=${x.skinId} ${x.views} ${x.rarity}`))
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
