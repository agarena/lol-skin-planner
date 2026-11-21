'use strict'
/**
 * 方案分享编码 v3 —— 全部使用公开标准
 *
 *   皮肤 ID → 排序后的位置索引（0..N-1）
 *          → 相邻差值 delta
 *          → varint（Google Protobuf 变长整数）
 *          → DEFLATE（RFC 1951，zlib raw）
 *          → Base64url（RFC 4648 §5，无填充）
 *          → 包在防误触包裹符里
 *
 * 长度实测（随机选皮肤，1967 款全集）：
 *   3 款 ≈ 10 字符 · 30 款 ≈ 47 · 100 款 ≈ 135 · 216 款 ≈ 200（上限）
 *
 * 为什么选这套而不是自己造大进制字符表：
 *   · 每一层都是公开标准，不需要维护字符集
 *   · 纯 ASCII，跨设备 / 输入法 / 系统零风险
 *   · Node 内置 zlib，实现只有几十行
 *
 * 压缩策略：小于 8 字节不压（deflate 对短数据反而变长）
 *   首字符 'c' = 已压缩，'r' = 原始
 */

const zlib = require('node:zlib')

/* ---------- varint（Protobuf 标准） ---------- */
function writeVarint(n, out) {
  let v = n
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
}

function readVarints(buf) {
  const out = []
  let i = 0
  while (i < buf.length) {
    let shift = 1
    let v = 0
    while (i < buf.length) {
      const b = buf[i++]
      v += (b & 0x7f) * shift
      if ((b & 0x80) === 0) break
      shift *= 128
    }
    out.push(v)
  }
  return out
}

/* ---------- Base64url（RFC 4648 §5） ---------- */
const b64uEncode = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uDecode = (s) => {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')
  while (t.length % 4) t += '='
  return Buffer.from(t, 'base64')
}


/* ---------- 到期日编码（2 字节，自 2020-01-01 起的天数） ---------- */
const EPOCH = Date.UTC(2020, 0, 1)

function dateToDays(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return 0
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = Math.round((t - EPOCH) / 86400000)
  return d >= 0 && d <= 65535 ? d : 0
}

function daysToDate(days) {
  if (!days) return null
  const t = EPOCH + days * 86400000
  const dt = new Date(t)
  const pad = (n) => String(n).padStart(2, '0')
  return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate())
}

/* ---------- 包裹符 ----------
 * 主格式：咕咕 … 嘎嘎（中文输入法打 gugu / gaga 就能出，不会和中英文符号混淆）
 * 后面几个是旧格式，只用于兼容已分享出去的码，不再生成
 */
const WRAPPERS = [['咕咕', '嘎嘎']]
const WRAP_MAIN = WRAPPERS[0]
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function extractWrapped(text) {
  const s = String(text || '')
  for (const [open, close] of WRAPPERS) {
    const re = new RegExp(esc(open) + '([^' + esc(close) + '\\n]{2,500})' + esc(close))
    const m = s.match(re)
    if (m && m[1]) return { body: m[1], open, close }
  }
  return null
}

function hasWrapper(text) {
  return extractWrapped(text) !== null
}

/* ---------- 索引表 ---------- */
function buildIndex(skinIds) {
  const sorted = [...new Set((skinIds || []).map(Number).filter(Boolean))].sort((a, b) => a - b)
  return { sorted, idToIdx: new Map(sorted.map((id, i) => [id, i])), total: sorted.length }
}

/* ---------- 编码 ---------- */
/**
 * @param {number[]} ids       皮肤 ID
 * @param {number[]} allSkinIds catalog 全部皮肤 ID
 * @returns {{code:string, chars:number, compressed:boolean}}
 */
function encode(ids, allSkinIds, expiresAt) {
  const map = buildIndex(allSkinIds)
  const idx = [...new Set((ids || []).map(Number))]
    .filter((id) => map.idToIdx.has(id))
    .map((id) => map.idToIdx.get(id))
    .sort((a, b) => a - b)
  if (!idx.length) return { code: '', chars: 0, compressed: false }

  // 主体：delta + varint
  const body = []
  let prev = 0
  for (const i of idx) {
    writeVarint(i - prev, body)
    prev = i
  }
  const raw = Buffer.from(body)

  // 头：总数(2B) + 数量(2B) + 到期日(2B，自 2020-01-01 起的天数，0=无)
  const head = Buffer.alloc(6)
  head.writeUInt16BE(map.total & 0xffff, 0)
  head.writeUInt16BE(idx.length & 0xffff, 2)
  head.writeUInt16BE(dateToDays(expiresAt), 4)

  const payload = Buffer.concat([head, raw])
  let out
  let compressed = false
  if (payload.length >= 12) {
    const z = zlib.deflateRawSync(payload, { level: 9 })
    if (z.length < payload.length) {
      out = 'c' + b64uEncode(z)
      compressed = true
    }
  }
  if (!out) out = 'r' + b64uEncode(payload)

  const code = WRAP_MAIN[0] + out + WRAP_MAIN[1]
  return { code, chars: code.length, compressed }
}

/* ---------- 解码 ---------- */
/**
 * @returns {{ids:number[]} | {error:string} | null}
 */
function decode(text, allSkinIds) {
  const w = extractWrapped(text)
  if (!w) return null
  const body = w.body.trim()
  if (body.length < 3) return { error: '分享码太短' }

  const flag = body[0]
  if (flag !== 'c' && flag !== 'r') return { error: '分享码格式不认识（应以 c 或 r 开头）' }

  let payload
  try {
    payload = b64uDecode(body.slice(1))
  } catch {
    return { error: '分享码解码失败' }
  }
  if (payload.length < 4) return { error: '分享码内容不完整' }

  if (flag === 'c') {
    try {
      payload = zlib.inflateRawSync(payload)
    } catch {
      return { error: '分享码解压失败，可能复制不完整' }
    }
  }

  const total = payload.readUInt16BE(0)
  const count = payload.readUInt16BE(2)
  const expDays = payload.length >= 6 ? payload.readUInt16BE(4) : 0
  const map = buildIndex(allSkinIds || [])

  if (!map.total) return { error: '需要先连接客户端才能解码' }
  if (total !== map.total) {
    return {
      error: `方案来自 ${total} 款皮肤的版本，当前 ${map.total} 款，索引已错位，无法还原`,
    }
  }
  if (!count || count > map.total) return { error: '皮肤数量异常' }

  const deltas = readVarints(payload.subarray(payload.length >= 6 ? 6 : 4))
  const idx = []
  let acc = 0
  for (const d of deltas) {
    acc += d
    idx.push(acc)
  }
  const ids = idx.slice(0, count).map((i) => map.sorted[i]).filter(Boolean)
  if (ids.length !== count) return { error: '还原出的皮肤数量不符' }
  return { ids, expiresAt: daysToDate(expDays) }
}

/* ---------- 解析路由（包裹符优先） ---------- */
function parseAny(text, allSkinIds) {
  const raw = String(text || '').trim()
  if (!raw) return null
  if (!hasWrapper(raw)) return null // 无包裹符 → 交给皮肤名模糊匹配
  const r = decode(raw, allSkinIds)
  if (r && r.ids) return { kind: 'code', ids: r.ids }
  return { kind: 'error', ids: [], error: (r && r.error) || '分享码解析失败' }
}

module.exports = { encode, decode, parseAny, hasWrapper, extractWrapped, WRAPPERS, WRAP_MAIN }
