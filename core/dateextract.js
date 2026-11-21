'use strict'
/**
 * 从文本里提取「到期时间」
 *
 * 规则（用户定义）：
 *   只有 1 个日期 → 它就是到期时间
 *   有多个日期   → 取最晚的那个
 *   完全没有日期 → 返回 null（界面显示「无」）
 *
 * 支持的写法：
 *   2026年12月4日 23:59
 *   2026-12-04  2026/12/4  2026.12.4
 *   12月4日（缺年份 → 补当前年；若已过则补明年）
 *   活动时间 2026年11月19日10:00-2026年12月4日23：59  ← 取 2026-12-04
 */

const pad = (n) => String(n).padStart(2, '0')

/** 归一化成 YYYY-MM-DD */
function toISO(y, m, d) {
  if (!y || !m || !d) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  if (y < 2000 || y > 2100) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * @param {string} text
 * @returns {string|null} YYYY-MM-DD 或 null
 */
function extractDeadline(text) {
  const src = String(text || '')
  if (!src.trim()) return null

  const found = []

  // ① 带年份：2026年12月4日 / 2026-12-04 / 2026/12/4 / 2026.12.4
  const reFull = /(\d{4})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})\s*[日号]?/g
  let m
  let stripped = src
  while ((m = reFull.exec(src)) !== null) {
    const iso = toISO(Number(m[1]), Number(m[2]), Number(m[3]))
    if (iso) found.push(iso)
    // 把这段从原文挖掉，避免「11月19日」被下面的无年份正则重复匹配
    stripped = stripped.replace(m[0], '\u0000'.repeat(m[0].length))
  }

  // ② 不带年份：12月4日（补当前年，若已过则明年）
  //    只在「没被带年份规则吃掉」的文本里找
  const reNoYear = /(?:^|[^\d\u0000])(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g
  const now = new Date()
  while ((m = reNoYear.exec(stripped)) !== null) {
    const mon = Number(m[1])
    const day = Number(m[2])
    const y = now.getFullYear()
    let iso = toISO(y, mon, day)
    if (!iso) continue
    // 该日期已过 → 视为明年
    const cmp = new Date(iso + 'T23:59:59')
    if (cmp < now) iso = toISO(y + 1, mon, day)
    if (iso) found.push(iso)
  }

  if (!found.length) return null

  // 取最晚的
  found.sort()
  return found[found.length - 1]
}

/** 格式化给人看：2026-12-04 → 2026年12月4日 */
function humanDeadline(iso) {
  if (!iso) return '无'
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`
}

module.exports = { extractDeadline, humanDeadline }
