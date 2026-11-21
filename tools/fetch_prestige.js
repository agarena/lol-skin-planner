'use strict'
/**
 * 抓取国服臻彩清单 → data/prestige-chromas.json
 *
 * 数据源：https://splash.buguoguo.cn/prestigechromas（布锅锅联盟宇宙，Next.js 静态页）
 *   完整数据内嵌在页面的 __NEXT_DATA__ 里：
 *     props.pageProps.allPrestigeChromas = [{
 *       id: chromaId, name: "莲华温泉 芸阿娜 雪落",
 *       splashPath / uncenteredSplashPath / loadScreenPath / tilePath,  ← 臻彩独立原画
 *       emblemPath, skinId, skinNum, originalIndex
 *     }, ...]   实测 497 条
 *
 * 这些原画托管在腾讯 CDN：game.gtimg.cn/images/lol/act/a20230715chromahub/
 * 说明数据源头是国服的「臻彩藏馆」活动页，布锅锅把它抓下来做成了静态站。
 *
 * 开源仓库：https://github.com/BuguoguoLoLCreator/lol-skin-explorer（GPLv3）
 *
 * 用法：node tools/fetch_prestige.js
 */
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const SRC = 'https://splash.buguoguo.cn/prestigechromas'
const OUT = path.join(__dirname, '..', 'data', 'prestige-chromas.json')

function get(url, timeout = 40000) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) lol-skin-planner/0.1',
          Accept: 'text/html',
        },
      },
      (res) => {
        const c = []
        res.on('data', (d) => c.push(d))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }))
      }
    )
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, body: '', error: 'timeout' })
    })
    req.end()
  })
}

async function main() {
  console.log('抓取', SRC)
  const r = await get(SRC)
  if (r.status !== 200) {
    console.error('失败 HTTP', r.status, r.error || '')
    process.exit(1)
  }
  console.log('页面', (r.body.length / 1024).toFixed(0) + 'KB')

  const m = r.body.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) {
    console.error('没找到 __NEXT_DATA__，页面结构可能变了')
    process.exit(1)
  }
  let data
  try {
    data = JSON.parse(m[1])
  } catch (e) {
    console.error('解析 __NEXT_DATA__ 失败:', e.message)
    process.exit(1)
  }

  const list = data && data.props && data.props.pageProps && data.props.pageProps.allPrestigeChromas
  if (!Array.isArray(list) || !list.length) {
    console.error('allPrestigeChromas 不存在或为空，页面结构可能变了')
    process.exit(1)
  }

  const items = list
    .filter((x) => x && x.id)
    .map((x) => ({
      chromaId: Number(x.id),
      name: x.name || '',
      splashPath: x.splashPath || '',
      uncenteredSplashPath: x.uncenteredSplashPath || '',
      loadScreenPath: x.loadScreenPath || '',
      tilePath: x.tilePath || '',
      emblemPath: x.emblemPath || '',
      skinNum: x.skinNum != null ? x.skinNum : null,
      originalIndex: x.originalIndex != null ? x.originalIndex : null,
    }))
    .sort((a, b) => a.chromaId - b.chromaId)

  const payload = {
    source: 'splash.buguoguo.cn/prestigechromas',
    sourceUrl: SRC,
    origin: '国服臻彩藏馆（原画托管于 game.gtimg.cn/images/lol/act/a20230715chromahub）',
    repo: 'https://github.com/BuguoguoLoLCreator/lol-skin-explorer',
    note: '国服臻彩 = 有独立原画的炫彩，与 Riot 的 rarity 分级无关',
    fetchedAt: new Date().toISOString(),
    count: items.length,
    items,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8')
  console.log(`写出 ${OUT}`)
  console.log(`  臻彩 ${items.length} 个`)
  items.slice(0, 5).forEach((x) => console.log(`    ${x.chromaId}  ${x.name}`))
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
