'use strict'
/**
 * 抓取全量皮肤的上线日期 → data/skin-release.json
 *
 * 为什么要外部源：LCU 的 /lol-store/v1/skins 只覆盖**在售**的 832 款（100% 有 releaseDate），
 * 已下架的 1135 款查单品接口直接 500。Meraki Analytics 的 champions.json 里
 * 每个皮肤的 release 字段 100% 有值（1825/1825），可以补齐全集。
 *
 * 数据源：https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json
 *   champions[Aatrox].skins[] = { id, name, release: "2013-06-12", rarity, cost, ... }
 *   其中 id 就是我们的 skinId
 *
 * 用法：node tools/fetch_release.js
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const URL_ = 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json'
const OUT = path.join(__dirname, '..', 'data', 'skin-release.json')

function fetchJson(url, timeout = 40000) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname + u.search,
        timeout,
        headers: { 'User-Agent': 'lol-skin-planner/0.1 (local app)', Accept: 'application/json' },
      },
      (res) => {
        const c = []
        res.on('data', (d) => c.push(d))
        res.on('end', () => {
          const t = Buffer.concat(c).toString('utf8')
          let j = null
          try {
            j = JSON.parse(t)
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, json: j, raw: t.slice(0, 160) })
        })
      }
    )
    req.on('error', (e) => resolve({ status: 0, json: null, raw: e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, json: null, raw: 'timeout' })
    })
    req.end()
  })
}

async function main() {
  console.log('抓取', URL_)
  const r = await fetchJson(URL_)
  if (r.status !== 200 || !r.json) {
    console.error('失败：', r.status, r.raw)
    process.exit(1)
  }

  const skins = {}
  const perChampion = new Map()
  let count = 0
  let noDate = 0

  for (const alias of Object.keys(r.json)) {
    const c = r.json[alias]
    if (!c || !Array.isArray(c.skins)) continue
    perChampion.set(alias, c.skins.length)
    for (const s of c.skins) {
      if (!s || !s.id) continue
      if (s.isBase) continue
      count += 1
      // Meraki 里有 '0000-00-00' 这种占位日期，必须过滤
      if (!s.release || /^0000/.test(String(s.release)) || !Date.parse(s.release)) {
        noDate += 1
        continue
      }
      skins[s.id] = {
        release: s.release, // "2016-11-28"
        releaseAt: Date.parse(s.release) || null,
        name: s.name,
        rarity: s.rarity || null,
        cost: s.cost || null,
      }
    }
  }

  const payload = {
    source: 'merakianalytics.com',
    sourceUrl: URL_,
    field: 'champions[].skins[].release',
    fetchedAt: new Date().toISOString(),
    championCount: perChampion.size,
    count: Object.keys(skins).length,
    missingDate: noDate,
    skins,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload), 'utf8')
  console.log(`写出 ${OUT}`)
  console.log(`英雄 ${perChampion.size} 个 / 非基础皮肤 ${count} 款 / 有日期 ${payload.count} / 缺日期 ${noDate}`)

  for (const id of [99007, 81005, 37077, 266001]) {
    const s = skins[id]
    console.log(`  ${id}: ${s ? s.release + ' · ' + s.name : '未收录'}`)
  }
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
