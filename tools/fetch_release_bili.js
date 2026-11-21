'use strict'
/**
 * 用 B 站皮肤演示视频的发布日期，补全缺失的皮肤上线时间
 *
 * 思路来自布锅锅：皮肤演示视频（白礼白里白 / SkinSpotlights 等）的发布日期
 * 与皮肤上线时间高度接近，可以当上线时间用。
 *
 * 接口：https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=...
 *   - 必须先访问一次 www.bilibili.com 拿 buvid3 cookie，否则第二次请求开始 412
 *   - 无需登录，但必须限速（1.5~2 秒/次）
 *
 * 匹配策略：候选结果里优先取「白礼白里白」的（国服正式版演示），
 *          其次取标题最匹配的，最后用最早日期兜底。
 *
 * 用法：
 *   node tools/fetch_release_bili.js            # 补全部缺失（限速，约 6~10 分钟）
 *   node tools/fetch_release_bili.js --limit 20 # 只补 20 个（启动时用）
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const OUT = path.join(__dirname, '..', 'data', 'skin-release.json')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const DELAY = 1800
const PREFERRED_AUTHORS = ['白礼白里白', 'SkinSpotlights']

let cookieJar = ''
let cookieAt = 0

function req(url, headers = {}, timeout = 20000) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const q = https.request({ host: u.hostname, path: u.pathname + u.search, timeout, headers }, (res) => {
      const c = []
      res.on('data', (d) => c.push(d))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString('utf8') }))
    })
    q.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message }))
    q.on('timeout', () => {
      q.destroy()
      resolve({ status: 0, headers: {}, body: 'timeout' })
    })
    q.end()
  })
}

async function ensureCookie(force = false) {
  if (!force && cookieJar && Date.now() - cookieAt < 30 * 60 * 1000) return cookieJar
  const r = await req('https://www.bilibili.com/', { 'User-Agent': UA, Accept: 'text/html' })
  const setCookie = r.headers['set-cookie'] || []
  cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ')
  cookieAt = Date.now()
  return cookieJar
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '')
}

function norm(s) {
  return String(s || '').replace(/[\s\u3000·・\-—_/\\|,，、.。!！?？"'“”‘’()（）【】]/g, '').toLowerCase()
}

/** 在候选结果里挑最合适的发布日期 */
function pickDate(list, skinName) {
  if (!Array.isArray(list) || !list.length) return null
  const target = norm(skinName)
  const scored = []

  for (const x of list) {
    const title = stripTags(x.title)
    const nTitle = norm(title)
    const match = norm(skinName) && nTitle.includes(target) ? 1 : 0
    const preferred = PREFERRED_AUTHORS.includes(x.author) ? 1 : 0
    const isPbe = /pbe|测试服|预览/i.test(title) ? -1 : 0
    scored.push({
      match,
      preferred,
      isPbe,
      pubdate: x.pubdate,
      author: x.author,
      title,
    })
  }

  // 必须标题里含皮肤名（去掉标点后），否则不认
  const valid = scored.filter((x) => x.match === 1)
  if (!valid.length) return null

  // 优先白礼白里白/SkinSpotlights；同优先级里取最早的正式版
  valid.sort((a, b) => b.preferred - a.preferred || b.isPbe - a.isPbe || a.pubdate - b.pubdate)
  const best = valid[0]
  return {
    date: new Date(best.pubdate * 1000).toISOString().slice(0, 10),
    title: best.title.slice(0, 60),
    author: best.author,
    candidates: valid.length,
  }
}

async function searchSkin(skinName) {
  const ck = await ensureCookie()
  const url =
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' +
    encodeURIComponent(skinName)
  const r = await req(url, {
    'User-Agent': UA,
    Referer: 'https://search.bilibili.com/',
    Accept: 'application/json',
    Cookie: ck,
  })
  if (r.status === 412) {
    await ensureCookie(true)
    return { ok: false, error: '412 限流' }
  }
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` }
  let j
  try {
    j = JSON.parse(r.body)
  } catch {
    return { ok: false, error: 'JSON 解析失败' }
  }
  if (j.code !== 0) return { ok: false, error: `code ${j.code} ${j.message || ''}` }
  const list = (j.data && j.data.result) || []
  const hit = pickDate(list, skinName)
  return hit ? { ok: true, ...hit } : { ok: false, error: `无匹配（候选 ${list.length}）` }
}

function lcuGet(p) {
  let conn = null
  try {
    conn = JSON.parse(fs.readFileSync(path.join(process.env.TEMP || '/tmp', 'lol-lcu-conn-cache.json'), 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const q = https.request(
      {
        host: '127.0.0.1',
        port: conn.port,
        path: p,
        timeout: 60000,
        rejectUnauthorized: false,
        headers: { Authorization: 'Basic ' + Buffer.from('riot:' + conn.token).toString('base64'), Accept: 'application/json' },
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
    q.on('error', () => resolve(null))
    q.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const limitIdx = process.argv.indexOf('--limit')
  const limit = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) || 20 : Infinity

  const raw = await lcuGet('/lol-game-data/assets/v1/skins.json')
  if (!raw) {
    console.error('拿不到本地皮肤库（客户端要开着）')
    process.exit(1)
  }
  const all = Object.values(raw).filter((s) => !s.isBase && !/^Jade_/.test(s.id))
  const rel = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  const missing = all.filter((s) => !rel.skins[s.id] && s.name)
  console.log(`缺失 ${missing.length} 款，本次最多处理 ${limit === Infinity ? '全部' : limit} 个`)

  const todo = missing.slice(0, limit === Infinity ? missing.length : limit)
  let ok = 0
  let fail = 0
  let i = 0

  for (const s of todo) {
    i++
    const r = await searchSkin(s.name)
    if (r.ok) {
      ok++
      rel.skins[s.id] = {
        release: r.date,
        releaseAt: Date.parse(r.date) || null,
        name: s.name,
        source: 'bilibili',
        evidence: `${r.author} · ${r.title}`,
      }
      process.stdout.write(`\r  [${i}/${todo.length}] ✅ ${s.name} → ${r.date}        `)
    } else {
      fail++
      process.stdout.write(`\r  [${i}/${todo.length}] ❌ ${s.name} (${r.error})        `)
    }
    // 每 20 个存一次盘，避免中断丢进度
    if (i % 20 === 0) {
      rel.fetchedAt = new Date().toISOString()
      rel.count = Object.keys(rel.skins).length
      fs.writeFileSync(OUT, JSON.stringify(rel), 'utf8')
    }
    await sleep(DELAY)
  }

  rel.fetchedAt = new Date().toISOString()
  rel.count = Object.keys(rel.skins).length
  rel.biliFilled = (rel.biliFilled || 0) + ok
  fs.writeFileSync(OUT, JSON.stringify(rel), 'utf8')
  console.log(`\n完成：成功 ${ok} / 失败 ${fail}，当前总覆盖 ${rel.count} 款`)
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
