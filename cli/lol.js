#!/usr/bin/env node
'use strict'
/**
 * 命令行入口 —— 给 skill / LLM / 脚本调用
 *
 * 用法：
 *   node cli/lol.js status
 *   node cli/lol.js collection --json
 *   node cli/lol.js top --limit 20 --json
 *   node cli/lol.js analyze --file list.txt --json
 *   node cli/lol.js analyze --text "星之守护者 阿狸" --json
 *   node cli/lol.js skin 1031 --json
 *
 * 国服需要管理员权限读客户端启动参数：命令会自动静默提权重跑一次，调用方无感。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (process.platform === 'win32') {
  try {
    spawnSync('chcp', ['65001'], { stdio: 'ignore', windowsHide: true })
  } catch {
    /* ignore */
  }
}

// 提权子进程通过 --argvFile 回传原始参数，避免命令行引号地狱
// 注意：--out 是提权时才加的，必须合并进来，否则子进程会把结果打到隐藏窗口里丢掉
function resolveArgv() {
  const i = process.argv.indexOf('--argvFile')
  if (i === -1) return process.argv.slice(2)
  const f = process.argv[i + 1]
  let base = []
  try {
    base = JSON.parse(fs.readFileSync(f, 'utf8'))
    fs.unlinkSync(f)
  } catch {
    base = []
  }
  const outIdx = process.argv.indexOf('--out')
  const outVal = outIdx > -1 ? process.argv[outIdx + 1] : null
  return outVal ? [...base, '--out', outVal] : base
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else {
        out[key] = next
        i++
      }
    } else out._.push(a)
  }
  return out
}

function rerunElevated(args) {
  const argvFile = path.join(os.tmpdir(), `lol-argv-${process.pid}.json`)
  const outFile = path.join(os.tmpdir(), `lol-out-${process.pid}.json`)
  fs.writeFileSync(argvFile, JSON.stringify(args), 'utf8')
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`
  const ps = [
    `$env:LOL_CLI_ELEVATED='1';`,
    `Start-Process -FilePath ${q(process.execPath)}`,
    `-ArgumentList @(${q(__filename)},'--argvFile',${q(argvFile)},'--out',${q(outFile)})`,
    // WindowStyle Hidden 必须留着：否则每次调用都会闪一个 node 控制台窗口
    `-Verb RunAs -Wait -WindowStyle Hidden`,
  ].join(' ')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 180000,
  })
  if (fs.existsSync(outFile)) {
    const txt = fs.readFileSync(outFile, 'utf8')
    fs.unlinkSync(outFile)
    process.stdout.write(txt)
    return true
  }
  process.stderr.write(
    '需要管理员权限读取客户端启动参数，但自动提权失败。\n' +
      '请用管理员身份打开终端后重试，或运行「启动(管理员).cmd」先打开界面。\n' +
      (r.error ? `(${r.error.message})\n` : '')
  )
  return false
}

const out = (obj, asJson, outFile) => {
  const text = asJson ? JSON.stringify(obj, null, 2) : obj
  if (outFile) {
    fs.writeFileSync(outFile, typeof text === 'string' ? text : JSON.stringify(obj, null, 2), 'utf8')
    return
  }
  process.stdout.write(typeof text === 'string' ? text + '\n' : JSON.stringify(obj, null, 2) + '\n')
}

function fmtRp(n) {
  return n == null ? '—' : String(n)
}

function humanAnalyze(r) {
  const lines = []
  const s = r.summary
  lines.push(`识别 ${s.matched}/${s.inputLines} 条，涉及 ${s.championLevel} 个英雄，未识别 ${s.unresolved}`)
  if (s.totalPrice) lines.push(`合计 ${s.totalPrice} 点券`)
  const label = { S: '零皮肤英雄', A: '等级升级', B: '同档折扣', C: '同档收藏', D: '不建议', skip: '已拥有' }
  for (const tier of ['S', 'A', 'B', 'C', 'D', 'skip']) {
    const g = r.groups[tier] || []
    if (!g.length) continue
    lines.push(`\n[${tier}] ${label[tier]} · ${g.length} 件`)
    for (const it of g) {
      const price = it.price && it.price.rp ? (it.price.nonRp ? '非点券' : `${it.price.rp}`) : '-'
      const u = it.usage ? ` LV.${it.usage.masteryLevel}` : ''
      lines.push(`  ${it.skinName}  |  ${it.championName}  |  ${it.rarityLabel}  |  ${price}${u}`)
      lines.push(`    ${it.reason}`)
    }
  }
  if (r.unresolved && r.unresolved.length) {
    lines.push('\n未识别：')
    for (const u of r.unresolved) lines.push(`  ${u.raw}  ← ${u.reason}`)
  }
  return lines.join('\n')
}

function humanTop(list) {
  const lines = [`常用英雄 Top ${list.length}（成就 × 对局）`]
  for (const c of list) {
    lines.push(
      `  #${String(c.rank).padStart(2)}  ${c.championName.padEnd(8)}  成就 ${String(c.masteryLevel).padStart(2)} 级 / ${String(
        c.masteryPoints
      ).padStart(7)} 分  ·  近 ${c.games} 场  ·  已拥有 ${c.ownedSkinCount} 款皮肤`
    )
  }
  return lines.join('\n')
}

function humanCollection(col) {
  const s = col.stats
  const zero = col.champions.filter((c) => c.owned && c.ownedSkinCount === 0)
  const lines = [
    `${col.summoner.gameName}#${col.summoner.tagLine}  Lv.${col.summoner.level}`,
    `英雄 ${s.championOwned}/${s.championTotal}   皮肤 ${s.skinOwned}/${s.skinTotal}   点券 ${fmtRp(col.summoner.rp)}`,
    `已过滤经典模式条目 ${s.removedClassic || 0} 个`,
    '',
    `零皮肤英雄 ${zero.length} 个：`,
    ...zero.slice(0, 30).map((c) => `  ${c.name}（${c.totalSkinCount} 款在售/可获取）`),
  ]
  if (zero.length > 30) lines.push(`  …还有 ${zero.length - 30} 个`)
  return lines.join('\n')
}

function humanStatus(s) {
  if (!s.connected) {
    return `未连接：${s.reason}${s.needsElevation ? '\n（客户端在运行，但读取凭据需要管理员权限）' : ''}`
  }
  return `已连接 ${s.summoner.gameName}#${s.summoner.tagLine}  Lv.${s.summoner.level}  端口 ${s.port}（来源 ${s.source}）`
}

async function main() {
  const argv = resolveArgv()
  const args = parseArgs(argv)
  const cmd = (args._[0] || 'status').toLowerCase()
  const asJson = !!args.json
  const outFile = typeof args.out === 'string' ? args.out : null

  let core
  try {
    core = require('../core')
  } catch (e) {
    process.stderr.write(`数据层加载失败：${e.message}\n`)
    process.exit(1)
  }

  // CLI 与桌面端共用缓存目录（若桌面端已拉过就秒回）
  const userCache = path.join(process.env.APPDATA || os.homedir(), 'lol-skin-planner', 'cache')
  core.configure({ cacheDir: userCache })

  try {
    switch (cmd) {
      case 'status': {
        const s = await core.status({ force: !!args.force })
        if (!s.connected && s.needsElevation && process.platform === 'win32' && !process.env.LOL_CLI_ELEVATED) {
          const ok = rerunElevated(argv)
          if (!ok) process.exit(3)
          return
        }
        return out(asJson ? s : humanStatus(s), asJson, outFile)
      }
      case 'collection': {
        const col = await core.getCollection({ force: !!args.force })
        if (!asJson) return out(humanCollection(col), false, outFile)
        const payload = {
          summoner: col.summoner,
          stats: col.stats,
          champions: col.champions.map((c) => ({
            id: c.id,
            name: c.name,
            owned: c.owned,
            roles: c.roles || [],
            ownedSkinCount: c.ownedSkinCount,
            totalSkinCount: c.totalSkinCount,
            maxRarityLabel: c.maxOwnedRarityLabel,
            skins: args.full
              ? c.skins.filter((s) => !s.isBase).map((s) => ({ id: s.id, name: s.name, owned: s.owned, rarity: s.rarityLabel }))
              : undefined,
          })),
        }
        return out(payload, true, outFile)
      }
      case 'top':
      case 'usage': {
        const list = await core.getTopChampions({ limit: Number(args.limit || 20), force: !!args.force })
        return out(asJson ? { champions: list } : humanTop(list), asJson, outFile)
      }
      case 'analyze': {
        let text = typeof args.text === 'string' ? args.text : ''
        if (typeof args.file === 'string') text = fs.readFileSync(args.file, 'utf8')
        if (!text && !process.stdin.isTTY) {
          try {
            text = fs.readFileSync(0, 'utf8')
          } catch {
            /* ignore */
          }
        }
        if (!text.trim()) {
          process.stderr.write('没有输入。用 --file <路径> 或 --text "皮肤名" 或管道传入。\n')
          process.exit(2)
        }
        const r = await core.analyze(text, {
          withPrices: !args['no-prices'],
          withUsage: !args['no-usage'],
          refresh: !!args.refresh,
        })
        return out(asJson ? r : humanAnalyze(r), asJson, outFile)
      }
      case 'skin': {
        const id = args._[1]
        if (!id) {
          process.stderr.write('用法：node cli/lol.js skin <skinId>\n')
          process.exit(2)
        }
        const s = await core.getSkin(id)
        return out(s, true, outFile)
      }
      case 'champion': {
        const id = args._[1]
        if (!id) {
          process.stderr.write('用法：node cli/lol.js champion <championId>\n')
          process.exit(2)
        }
        const c = await core.getChampion(id)
        return out(c, true, outFile)
      }
      case 'prefs': {
        const r = await core.getSkinPreferences()
        if (!asJson) {
          if (!r.available) return out(`拿不到皮肤偏好：${r.reason}`, false, outFile)
          const lines = [
            `每个英雄上次选的皮肤：${r.total} 条（跳过经典模式 ${r.skippedClassic} 条）`,
            `来源 ${r.file}`,
            `更新于 ${new Date(r.updatedAt).toLocaleString('zh-CN')}`,
            '',
            ...r.entries.map(
              (e) =>
                `  ${String(e.championId).padStart(3)}  ${(e.championName || '?').padEnd(10)} → ${e.skinName || e.skinId}${
                  e.isBase ? '（默认皮肤）' : ''
                }`
            ),
          ]
          return out(lines.join('\n'), false, outFile)
        }
        return out(r, true, outFile)
      }
      case 'plans': {
        const list = await core.listPlans()
        if (!asJson) {
          if (!list.length) return out('还没有方案。用 --create 创建：node cli/lol.js plans --create "方案名" --skins 103014,2025', false, outFile)
          const lines = [`共 ${list.length} 个方案：`]
          for (const p of list) {
            lines.push(`  ${p.id}  ${p.name}  ${p.skinIds.length} 款  预算 ${p.budget.rp || '-'} 点券 / ${p.budget.mythic || '-'} 精萃`)
          }
          return out(lines.join('\n'), false, outFile)
        }
        return out({ plans: list }, true, outFile)
      }
      case 'plan': {
        const sub = args._[1] || 'list'
        if (sub === 'create') {
          const skinIds = String(args.skins || '').split(',').map(Number).filter(Boolean)
          const p = await core.savePlan({
            name: args.name || '未命名方案',
            skinIds,
            budget: { rp: Number(args.rp) || 0, mythic: Number(args.mythic) || 0 },
          })
          return out(asJson ? p : `已创建：${p.id}  ${p.name}（${p.skinIds.length} 款）`, asJson, outFile)
        }
        if (sub === 'show') {
          const id = args._[2] || args.id
          const p = await core.listPlans().then((l) => l.find((x) => x.id === id))
          if (!p) { process.stderr.write('方案不存在\n'); process.exit(2) }
          // 实时对账：价格 / 拥有状态全部现算
          const col = await core.getCollection()
          const priceMap = await core.getPrices().catch(() => ({}))
          const items = p.skinIds.map((sid) => {
            let hit = null, champName = ''
            for (const c of col.champions) {
              const h = c.skins.find((s) => s.id === sid)
              if (h) { hit = h; champName = c.name; break }
            }
            const pr = priceMap[sid] || null
            return {
              skinId: sid,
              name: hit ? hit.name : String(sid),
              championName: champName,
              state: hit ? hit.state : 'none',
              owned: hit ? hit.owned : false,
              rp: pr && pr.rp != null ? pr.rp : null,
              originalRp: pr && pr.originalRp != null ? pr.originalRp : null,
            }
          })
          const total = items.filter((x) => !x.owned).reduce((s, x) => s + (x.rp || 0), 0)
          const result = {
            ...p,
            items,
            summary: {
              count: items.length,
              ownedCount: items.filter((x) => x.owned).length,
              lootCount: items.filter((x) => x.state === 'lootPermanent' || x.state === 'lootShard').length,
              totalRp: total,
              overBudget: p.budget.rp ? total > p.budget.rp : null,
            },
          }
          if (!asJson) {
            const lines = [`${p.name}  (${p.id})`]
            lines.push(
              `预算 ${p.budget.rp || '-'} 点券  ·  当前需 ${total} 点券` +
                (result.summary.overBudget ? '  ⚠️ 超预算' : '')
            )
            for (const x of items) {
              const tag =
                x.state === 'owned'
                  ? '已拥有'
                  : x.state === 'lootPermanent'
                    ? '战利品可解锁'
                    : x.state === 'lootShard'
                      ? '有碎片'
                      : ''
              lines.push(`  ${x.skinId}  ${x.name}  ${x.championName}  ${x.rp != null ? x.rp : '-'}  ${tag}`)
            }
            return out(lines.join('\n'), false, outFile)
          }
          return out(result, true, outFile)
        }
        if (sub === 'delete') {
          const id = args._[2] || args.id
          const ok = await core.deletePlan(id)
          return out(asJson ? { ok } : (ok ? '已删除' : '方案不存在'), asJson, outFile)
        }
        process.stderr.write('用法：plan create|show|delete\n')
        process.exit(2)
      }      case 'current': {
        const s = await core.getCurrentSelection()
        if (!asJson) {
          if (!s.inChampSelect) return out(`不在选人阶段（当前：${s.phase || '未知'}）。${s.reason}`, false, outFile)
          return out(
            `选人阶段 · 英雄 ${s.championId} · 皮肤 ${s.skin && s.skin.name ? s.skin.name : s.selectedSkinId}`,
            false,
            null
          )
        }
        return out(s, true, outFile)
      }
      case 'help':
      default: {
        process.stdout.write(
          [
            'LOL 皮肤决策助手 · 数据层 CLI',
            '',
            '  status                       连接状态',
            '  collection [--json] [--full] 藏品（--full 带每款皮肤）',
            '  top [--limit N] [--json]     常用英雄榜（成就 × 对局）',
            '  analyze --file|-text --json  清单分析（核心）',
            '  skin <skinId>                单品详情 + 是否已拥有 + 价格',
            '  champion <championId>        单英雄全部皮肤',
            '',
            '通用：--json 输出结构化；--out <file> 写文件；--force 忽略缓存',
            '',
          ].join('\n')
        )
        return
      }
    }
  } catch (e) {
    if (e.code === 'NEEDS_ELEVATION' && process.platform === 'win32' && !process.env.LOL_CLI_ELEVATED) {
      const ok = rerunElevated(argv)
      if (!ok) process.exit(3)
      return
    }
    process.stderr.write(`错误：${e.message}\n`)
    if (e.diagnose && e.diagnose.reason) process.stderr.write(`诊断：${e.diagnose.reason}\n`)
    process.exit(1)
  }
}

main()
