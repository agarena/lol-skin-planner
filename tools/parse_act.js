'use strict'
/**
 * 解析腾讯活动页的活动商品清单 → data/act-sale.json
 *
 * 数据来源：https://lol.qq.com/act/a20261115champion/page2.html
 *   → js/data.js（GBK 编码，452KB）
 *   里面定义了 7 个数据集，其中两个是本次活动的打折清单：
 *     window.skinSaleData1  全场半价（点券）  字段 { skinName, sj:原价, zkj:折后价, skinId:contentId }
 *     window.skinSaleData2  神话半价           字段 { skinName, yj:原价精萃, price:折后精萃, skinId:contentId }
 *
 * 关键：活动页的 skinId 是 contentId（UUID），需要用静态皮肤库的 contentId 反查出数字 skinId。
 *
 * 用法：node tools/parse_act.js [--date 20261115champion]
 *   会依次尝试：本地 LCU 的 skins.json → CommunityDragon 的 zh_cn skins.json
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const OUT = path.join(__dirname, '..', 'data', 'act-sale.json')
const ACT_ID = 'a20261115champion'
const BASE = `https://lol.qq.com/act/${ACT_ID}`

function fetchBuf(url, timeout = 30000) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname + u.search,
        timeout,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) lol-skin-planner/0.1' },
      },
      (res) => {
        const c = []
        res.on('data', (d) => c.push(d))
        res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(c) }))
      }
    )
    req.on('error', () => resolve({ status: 0, buf: null }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, buf: null })
    })
    req.end()
  })
}

/** 按括号配对从 JS 源码里取出 window.xxx 的数组字面量 */
function extractArray(src, name) {
  const at = src.indexOf(`window.${name}`)
  if (at < 0) return null
  const open = src.indexOf('[', at)
  if (open < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(src.slice(open, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** contentId(UUID) → { id, name } */
async function buildContentMap() {
  const map = new Map()

  // 1) 本地 LCU（最准，还带中文名）
  try {
    const conn = JSON.parse(
      fs.readFileSync(path.join(process.env.TEMP || '/tmp', 'lol-lcu-conn-cache.json'), 'utf8').replace(/^\uFEFF/, '')
    )
    const r = await new Promise((resolve) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port: conn.port,
          path: '/lol-game-data/assets/v1/skins.json',
          timeout: 60000,
          rejectUnauthorized: false,
          headers: {
            Authorization: 'Basic ' + Buffer.from(`riot:${conn.token}`).toString('base64'),
            Accept: 'application/json',
          },
        },
        (res) => {
          const c = []
          res.on('data', (d) => c.push(d))
          res.on('end', () => resolve(Buffer.concat(c)))
        }
      )
      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
      req.end()
    })
    if (r) {
      const j = JSON.parse(r.toString('utf8'))
      for (const k of Object.keys(j)) {
        const s = j[k]
        if (s && s.contentId) map.set(String(s.contentId).toLowerCase(), { id: s.id, name: s.name })
      }
      console.log(`contentId 映射（本地 LCU）: ${map.size} 条`)
    }
  } catch {
    /* 用 CD 兜底 */
  }

  // 2) CommunityDragon 兜底
  if (map.size === 0) {
    console.log('本地拿不到，改用 CommunityDragon…')
    const r = await fetchBuf(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/skins.json',
      90000
    )
    if (r.buf) {
      const j = JSON.parse(r.buf.toString('utf8'))
      for (const k of Object.keys(j)) {
        const s = j[k]
        if (s && s.contentId) map.set(String(s.contentId).toLowerCase(), { id: s.id, name: s.name })
      }
      console.log(`contentId 映射（CommunityDragon）: ${map.size} 条`)
    }
  }
  return map
}

async function main() {
  console.log(`抓取 ${BASE}/js/data.js`)
  const r = await fetchBuf(`${BASE}/js/data.js`, 40000)
  if (!r.buf) {
    console.error('抓取失败')
    process.exit(1)
  }
  // 页面是 GBK
  const src = new TextDecoder('gbk').decode(r.buf)
  console.log(`data.js ${(r.buf.length / 1024).toFixed(0)}KB`)

  const sale1 = extractArray(src, 'skinSaleData1') || []
  const sale2 = extractArray(src, 'skinSaleData2') || []
  console.log(`skinSaleData1(点券) ${sale1.length} 条 / skinSaleData2(神话精萃) ${sale2.length} 条`)

  const cmap = await buildContentMap()

  const convert = (arr, kind) => {
    const out = []
    let miss = 0
    for (const it of arr) {
      const key = String(it.skinId || '').toLowerCase()
      const hit = cmap.get(key)
      if (!hit) {
        miss += 1
        continue
      }
      if (kind === 'rp') {
        out.push({
          skinId: hit.id,
          name: hit.name,
          original: it.sj != null ? Math.round(Number(it.sj) * 100) : null,
          price: it.zkj != null ? Math.round(Number(it.zkj) * 100) : null,
          currency: 'RP',
        })
      } else {
        out.push({
          skinId: hit.id,
          name: hit.name,
          original: it.yj != null ? Number(it.yj) : null,
          price: it.price != null ? Number(it.price) : null,
          currency: 'Mythic Essence',
        })
      }
    }
    return { list: out, miss }
  }

  const rp = convert(sale1, 'rp')
  const my = convert(sale2, 'me')

  const payload = {
    source: '腾讯活动页 ' + BASE + '/page2.html',
    actId: ACT_ID,
    note: '夺冠庆典：全场半价（点券）+ 神话级皮肤限时半价（神话精萃）',
    fetchedAt: new Date().toISOString(),
    rpSale: { count: rp.list.length, unmapped: rp.miss, items: rp.list },
    mythicSale: { count: my.list.length, unmapped: my.miss, items: my.list },
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8')
  console.log(`写出 ${OUT}`)
  console.log(`  点券半价 ${rp.list.length} 款（未映射 ${rp.miss}）`)
  console.log(`  神话半价 ${my.list.length} 款（未映射 ${my.miss}）`)
  my.list.slice(0, 12).forEach((x) => console.log(`    ${x.name} ${x.original}→${x.price} 精萃`))
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
