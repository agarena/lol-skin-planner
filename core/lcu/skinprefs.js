'use strict'
/**
 * 每个英雄「上次选的皮肤」
 *
 * 来源：客户端配置 <install>/Config/LCUAccountPreferences.yaml
 *   champ-select:
 *       data:
 *           skins:
 *               1: 1012        ← championId: skinId
 *               103: 103006
 *
 * 说明：LOL 没有「装备皮肤」的概念，但客户端会记住你在选人界面最后一次
 * 给每个英雄选的那款皮肤，下次进 BP 时默认就选它 —— 这份偏好就存在上面这个文件里。
 * 该文件随客户端更新/切换账号变化，所以每次读实时内容，不做长缓存。
 */
const fs = require('node:fs')
const path = require('node:path')

const PREFS_REL = path.join('Config', 'LCUAccountPreferences.yaml')

/** 候选路径：进程安装目录 → lockfile 同级 → 常见盘符兜底 */
function candidateFiles(conn) {
  const out = []
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p)
  }
  if (conn && conn.installDir) push(path.join(conn.installDir, PREFS_REL))
  if (conn && conn.lockfile) push(path.join(path.dirname(conn.lockfile), PREFS_REL))

  const rels = [
    'WeGameApps\\英雄联盟\\LeagueClient',
    'Program Files\\Tencent\\英雄联盟\\LeagueClient',
    'Program Files (x86)\\Tencent\\英雄联盟\\LeagueClient',
    '腾讯游戏\\英雄联盟\\LeagueClient',
    'Games\\英雄联盟\\LeagueClient',
    'Program Files\\Riot Games\\League of Legends',
    'Riot Games\\League of Legends',
  ]
  for (const L of 'CDEFGH') {
    for (const r of rels) push(`${L}:\\${r}\\${PREFS_REL}`)
  }
  return out
}

function findPrefsFile(conn) {
  for (const f of candidateFiles(conn)) {
    try {
      if (fs.statSync(f).isFile()) return f
    } catch {
      /* next */
    }
  }
  return null
}

/**
 * 解析 YAML 里 champ-select.data.skins 这一段
 * 只认这个固定结构，不引 YAML 库
 */
function parseSkinPrefs(text) {
  const out = {}
  const lines = String(text || '').split(/\r?\n/)
  let inChampSelect = false
  let inSkins = false

  for (const line of lines) {
    if (!line.trim()) continue

    // 顶格的新 key
    if (/^\S/.test(line)) {
      inChampSelect = /^champ-select:\s*$/.test(line)
      inSkins = false
      continue
    }
    if (!inChampSelect) continue

    const keyMatch = line.match(/^(\s+)([A-Za-z0-9_-]+):\s*$/)
    if (keyMatch) {
      const indent = keyMatch[1].length
      const key = keyMatch[2]
      if (indent === 4 && key === 'data') {
        inSkins = false
        continue
      }
      if (indent === 8 && key === 'skins') {
        inSkins = true
        continue
      }
      if (indent <= 8) inSkins = false
      continue
    }

    if (!inSkins) continue
    const kv = line.match(/^\s+(\d+):\s*(\d+)\s*$/)
    if (kv) out[Number(kv[1])] = Number(kv[2])
  }
  return out
}

/**
 * 读取并解析，输出带皮肤名的列表
 * @param {object} conn 连接信息（用于定位安装目录）
 * @param {object} catalog catalog.load() 结果（用于皮肤名/等级）
 */
function readSkinPreferences(conn, catalog) {
  const file = findPrefsFile(conn)
  if (!file) {
    return { available: false, reason: '没找到 LCUAccountPreferences.yaml', file: null, entries: [] }
  }
  let text
  let mtime = 0
  try {
    text = fs.readFileSync(file, 'utf8')
    mtime = fs.statSync(file).mtimeMs
  } catch (e) {
    return { available: false, reason: `读取失败：${e.message}`, file, entries: [] }
  }

  const map = parseSkinPrefs(text)
  const entries = []
  let skippedClassic = 0

  for (const [championIdStr, skinId] of Object.entries(map)) {
    const championId = Number(championIdStr)
    // 经典模式（Jade）条目直接跳过
    if (championId >= 60000 || Math.floor(skinId / 1000) >= 60000) {
      skippedClassic += 1
      continue
    }
    const meta = (catalog && catalog.skins && catalog.skins[skinId]) || null
    const champMeta = (catalog && catalog.champions && catalog.champions[championId]) || null
    entries.push({
      championId,
      championName: champMeta ? champMeta.name : '',
      skinId,
      skinName: meta ? meta.name : '',
      rarityLabel: meta ? meta.rarityLabel : '',
      rarityRank: meta ? meta.rarityRank : 0,
      isBase: skinId === championId * 1000,
    })
  }

  entries.sort((a, b) => a.championId - b.championId)
  return {
    available: true,
    file,
    updatedAt: mtime,
    total: entries.length,
    skippedClassic,
    entries,
    byChampion: Object.fromEntries(entries.map((e) => [e.championId, e])),
  }
}

module.exports = { readSkinPreferences, parseSkinPrefs, findPrefsFile, candidateFiles }
