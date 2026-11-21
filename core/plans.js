'use strict'
/**
 * 预算方案存储
 *
 * 设计原则（用户定的）：方案里**只存 ID 和名称**，价格 / 拥有状态 / 梯度
 * 全部在打开时实时关联，避免快照数据与商城数据打架。
 *
 *   {
 *     "plans": [{
 *       "id": "plan_20261119_1730_a1b2",
 *       "name": "BLG 活动方案 A",
 *       "createdAt": "...", "updatedAt": "...",
 *       "skinIds": [103014, 2025],
 *       "budget": { "rp": 50000, "mythic": 272 }
 *     }]
 *   }
 *
 * budget 是用户设定的上限（可改），不是余额快照。
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

let filePath = path.join(os.tmpdir(), 'lol-skin-plans.json')
let mem = null

function configure({ dataDir } = {}) {
  if (dataDir) {
    filePath = path.join(dataDir, 'plans.json')
    mem = null
  }
}

function load() {
  if (mem) return mem
  let raw = { plans: [] }
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    /* 首次使用 */
  }
  if (!Array.isArray(raw.plans)) raw.plans = []

  // 一次性迁移：把旧的「MM-DD HH:MM」格式名改成「YYYY-MM-DD 方案N」
  let changed = false
  const legacy = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/
  const byDay = {}
  for (const p of raw.plans) {
    if (!legacy.test(String(p.name || ''))) continue
    const d = new Date(p.createdAt || Date.now())
    const pad = (n) => String(n).padStart(2, '0')
    const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    byDay[day] = (byDay[day] || 0) + 1
    p.name = day + ' 方案' + byDay[day]
    changed = true
  }
  if (changed) {
    mem = raw
    save()
  }

  mem = raw
  return mem
}

function save() {
  const data = load()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 1), 'utf8')
  return true
}

function newId() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
  const rand = Math.random().toString(36).slice(2, 6)
  return `plan_${stamp}_${rand}`
}

function listPlans() {
  return load().plans.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

function getPlan(id) {
  return load().plans.find((p) => p.id === id) || null
}

function createPlan({ name, skinIds = [], budget = {}, expiresAt = null } = {}) {
  const data = load()
  const now = new Date()
  const nowIso = now.toISOString()
  const ids = [...new Set(skinIds.map(Number).filter(Boolean))].sort((a, b) => a - b)

  // 同一皮肤组合不重复生成：命中已有方案则只刷新时间
  const key = ids.join(',')
  const same = data.plans.find((p) => [...p.skinIds].sort((a, b) => a - b).join(',') === key)
  if (same) {
    same.updatedAt = nowIso
    if (expiresAt !== undefined) same.expiresAt = expiresAt
    // 传了 name 说明是用户主动命名（确认弹窗 / 改名），直接覆盖
    // 自动保存不传 name，此时保留原名称
    if (name) {
      same.name = String(name).slice(0, 60)
      same.renamedByUser = true
    }
    save()
    return { ...same, reused: true }
  }

  // 默认名：2026-11-20 方案1（同一天内递增）
  const pad = (n) => String(n).padStart(2, '0')
  const dateStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  const sameDay = data.plans.filter((x) => String(x.name || '').startsWith(dateStr)).length
  const autoName = dateStr + ' 方案' + (sameDay + 1)
  const label = dateStr + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes())

  const plan = {
    id: newId(),
    name: String(name || autoName).slice(0, 60),
    label,
    createdAt: nowIso,
    updatedAt: nowIso,
    skinIds: ids,
    expiresAt: expiresAt || null,
    budget: { rp: Number(budget.rp) || 0, mythic: Number(budget.mythic) || 0 },
  }
  data.plans.push(plan)
  save()
  return plan
}

function updatePlan(id, patch = {}) {
  const data = load()
  const plan = data.plans.find((p) => p.id === id)
  if (!plan) return null
  if (patch.expiresAt !== undefined) plan.expiresAt = patch.expiresAt || null
  if (patch.name != null) {
    plan.name = String(patch.name).slice(0, 60)
    plan.renamedByUser = true // 记住「用户手动改过」，之后自动保存不再覆盖
  }
  if (Array.isArray(patch.skinIds)) plan.skinIds = [...new Set(patch.skinIds.map(Number).filter(Boolean))]
  if (patch.budget) {
    plan.budget = {
      rp: Number(patch.budget.rp) || 0,
      mythic: Number(patch.budget.mythic) || 0,
    }
  }
  plan.updatedAt = new Date().toISOString()
  save()
  return plan
}

function deletePlan(id) {
  const data = load()
  const i = data.plans.findIndex((p) => p.id === id)
  if (i < 0) return false
  data.plans.splice(i, 1)
  save()
  return true
}

function addSkins(id, skinIds = []) {
  const plan = getPlan(id)
  if (!plan) return null
  const merged = [...new Set([...plan.skinIds, ...skinIds.map(Number).filter(Boolean)])]
  return updatePlan(id, { skinIds: merged })
}

function removeSkin(id, skinId) {
  const plan = getPlan(id)
  if (!plan) return null
  return updatePlan(id, { skinIds: plan.skinIds.filter((x) => x !== Number(skinId)) })
}

/** 全部方案的皮肤 ID 并集（给商城标「在某方案里」用） */
function allPlannedSkinIds() {
  const set = new Set()
  for (const p of load().plans) for (const id of p.skinIds) set.add(id)
  return [...set]
}

const share3 = require('./share3')

/** 导出方案为分享码（需要 catalog 的全部皮肤 ID 来建索引） */
function sharePlan(id, allSkinIds) {
  const p = getPlan(id)
  if (!p) return null
  const r = share3.encode(p.skinIds, allSkinIds, p.expiresAt)
  return { code: r.code, chars: r.chars, count: p.skinIds.length, name: p.name, expiresAt: p.expiresAt || null }
}

/** 从分享码导入方案 */
function importPlan(code, name, allSkinIds) {
  const r = share3.decode(code, allSkinIds)
  if (!r || !r.ids || !r.ids.length) {
    return { ok: false, error: (r && r.error) || '没有解析出皮肤' }
  }
  const plan = createPlan({ name: name || undefined, skinIds: r.ids, expiresAt: r.expiresAt || null })
  return { ok: true, plan }
}

module.exports = {
  configure,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  addSkins,
  removeSkin,
  allPlannedSkinIds,
  sharePlan,
  importPlan,
  filePath: () => filePath,
}
