'use strict'
/**
 * 英雄成就（熟练度）
 * GET /lol-champion-mastery/v1/local-player/champion-mastery
 * → championLevel(1..15+), championPoints, lastPlayTime, highestGrade
 * 这是判断「常玩英雄」最可靠的本地信号：点数不会因为版本改动而失真。
 */
const { lcuRequest } = require('./api')

const cache = { at: 0, data: null }
const TTL = 90 * 1000

async function getMastery(conn, { force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < TTL) return cache.data
  const r = await lcuRequest(conn, '/lol-champion-mastery/v1/local-player/champion-mastery', { timeout: 20000 })
  if (r.status !== 200 || !Array.isArray(r.json)) {
    return { available: false, error: `HTTP ${r.status}`, entries: [], fetchedAt: Date.now() }
  }
  const entries = r.json
    .filter((m) => m && m.championId)
    .map((m) => ({
      championId: m.championId,
      level: m.championLevel || 0,
      points: m.championPoints || 0,
      lastPlayTime: m.lastPlayTime || 0,
      highestGrade: m.highestGrade || '',
      tokens: m.tokensEarned || 0,
      milestone: m.championSeasonMilestone || 0,
    }))
    .sort((a, b) => b.points - a.points)

  const data = { available: true, entries, fetchedAt: Date.now() }
  cache.data = data
  cache.at = Date.now()
  return data
}

/** 分数档位（用于 UI 上色） */
function masteryTier(level) {
  if (level >= 10) return { label: '大师级', cls: 'mt-10' }
  if (level >= 7) return { label: '精通', cls: 'mt-7' }
  if (level >= 5) return { label: '熟练', cls: 'mt-5' }
  return { label: '入门', cls: 'mt-1' }
}

module.exports = { getMastery, masteryTier }
