'use strict'
/**
 * 常用英雄画像：只依赖「成就等级 + 成就点数」
 *
 * 为什么不再拉对局：
 *   1. LCU 单次只给 20 场，20 场根本代表不了「近 30 天」（正常强度下 30 天 200+ 场）
 *   2. 常玩英雄的判定用成就等级已经足够——近期玩过的大概率就是成就等级高的那几个
 *   3. 省掉一次 /lol-match-history 请求（约 600ms）
 *
 * 输出结构保持 champions / byChampion；行内对局字段仍保留但恒为 0，
 * 避免下游大面积改动。
 */
const mastery = require('./lcu/mastery')

async function buildUsage(conn, puuid, { force = false } = {}) {
  const m = await mastery.getMastery(conn, { force })

  const map = new Map()
  const ensure = (championId) => {
    if (!map.has(championId)) {
      map.set(championId, {
        championId,
        masteryLevel: 0,
        masteryPoints: 0,
        highestGrade: '',
        lastPlayTime: 0,
        // 以下字段保留但恒为 0（对局数据不再采集）
        games: 0,
        wins: 0,
        winRate: 0,
        lastPlayed: 0,
        recent30: 0,
        recent7: 0,
        score: 0,
      })
    }
    return map.get(championId)
  }

  for (const e of m.entries || []) {
    const row = ensure(e.championId)
    row.masteryLevel = e.level
    row.masteryPoints = e.points
    row.highestGrade = e.highestGrade
    row.lastPlayTime = e.lastPlayTime
  }

  // 排序只用成就等级 + 点数
  for (const row of map.values()) {
    row.score = row.masteryLevel * 1000 + row.masteryPoints / 100
  }

  const ranked = [...map.values()].sort((a, b) => b.score - a.score)
  ranked.forEach((r, i) => {
    r.rank = i + 1
  })

  return {
    available: m.available,
    masteryAvailable: m.available,
    champions: ranked,
    byChampion: Object.fromEntries(ranked.map((r) => [r.championId, r])),
    fetchedAt: Date.now(),
  }
}

module.exports = { buildUsage }
