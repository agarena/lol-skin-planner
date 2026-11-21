'use strict'
/**
 * LCU 连接发现
 * 顺序：常见路径 lockfile → 进程命令行 → 用户手动指定
 * 全程只读，不注入、不写客户端目录。
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFile, execFileSync } = require('node:child_process')

const CACHE_TTL = 4000
let cache = { at: 0, conn: null }

/**
 * 连接信息磁盘缓存：CLI 每次运行都提权会很吵（还会闪 node 窗口），
 * 所以把成功的 port/token 落到 tmp，10 分钟内复用，避免重复提权。
 * token 在客户端重启后失效，verify() 会挡住过期的。
 */
const os = require('node:os')
const CONN_CACHE_FILE = path.join(os.tmpdir(), 'lol-lcu-conn-cache.json')
const CONN_CACHE_TTL = 24 * 60 * 60 * 1000

function readConnCache() {
  try {
    const raw = fs.readFileSync(CONN_CACHE_FILE, 'utf8').replace(/^\uFEFF/, '')
    const j = JSON.parse(raw)
    if (j && j.port && j.token && Date.now() - (j.at || 0) < CONN_CACHE_TTL) {
      return { port: j.port, token: j.token, protocol: 'https', source: 'cache' }
    }
  } catch {
    /* 没有缓存 */
  }
  return null
}

function writeConnCache(conn) {
  try {
    fs.writeFileSync(
      CONN_CACHE_FILE,
      JSON.stringify({ port: conn.port, token: conn.token, at: Date.now() }),
      'utf8'
    )
  } catch {
    /* 写不了就算了 */
  }
}

function listDrives() {
  const out = []
  for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    try {
      if (fs.existsSync(`${L}:\\`)) out.push(`${L}:`)
    } catch {
      /* ignore */
    }
  }
  return out
}

/** 常见安装布局（国服 WeGame / 官服 / 自定义盘符） */
function lockfileCandidates() {
  const rel = [
    'WeGameApps\\英雄联盟\\LeagueClient',
    'WeGameApps\\League of Legends\\LeagueClient',
    'Program Files\\Tencent\\英雄联盟\\LeagueClient',
    'Program Files (x86)\\Tencent\\英雄联盟\\LeagueClient',
    '腾讯游戏\\英雄联盟\\LeagueClient',
    'Tencent\\英雄联盟\\LeagueClient',
    'Games\\英雄联盟\\LeagueClient',
    'Game\\英雄联盟\\LeagueClient',
    'LOL\\LeagueClient',
    'Program Files\\Riot Games\\League of Legends',
    'Program Files (x86)\\Riot Games\\League of Legends',
    'Riot Games\\League of Legends',
    'Games\\Riot Games\\League of Legends',
  ]
  const roots = []
  for (const d of listDrives()) {
    for (const r of rel) roots.push(`${d}\\${r}`)
  }
  // 环境变量兜底
  for (const env of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
    const b = process.env[env]
    if (b) {
      roots.push(path.join(b, 'Tencent', '英雄联盟', 'LeagueClient'))
      roots.push(path.join(b, 'Riot Games', 'League of Legends'))
    }
  }
  return [...new Set(roots.map((p) => path.join(p, 'lockfile')))]
}

/** lockfile 格式： name:pid:port:password:protocol */
function parseLockfile(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
  if (!raw) return null
  const parts = raw.split(':')
  if (parts.length < 5) return null
  const port = Number(parts[2])
  const token = parts[3]
  if (!port || !token) return null
  return { port, token, protocol: parts[4] || 'https', lockfile: file }
}

function fromLockfiles() {
  for (const f of lockfileCandidates()) {
    const c = parseLockfile(f)
    if (c) return { ...c, source: 'lockfile' }
  }
  return null
}

/** 进程命令行兜底：能覆盖任意自定义安装路径 */
function fromProcess() {
  return new Promise((resolve) => {
    const ps =
      "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" " +
      '| Select-Object -First 1 -ExpandProperty CommandLine'
    execFile(
      'powershell.exe',
      // -WindowStyle Hidden + windowsHide 双保险：这个调用在应用启动时可能触发，
      // 不能让它闪控制台窗口
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps],
      { windowsHide: true, timeout: 12000, windowsVerbatimArguments: false },
      (err, stdout) => {
        if (err || !stdout) return resolve(null)
        const line = stdout.trim()
        if (!line) return resolve(null)
        const pick = (flag) => {
          const m = line.match(new RegExp(`${flag}=("[^"]+"|\\S+)`))
          return m ? m[1].replace(/^"|"$/g, '') : null
        }
        const port = Number(pick('--app-port'))
        const token = pick('--remoting-auth-token')
        if (!port || !token) return resolve(null)
        const dir = pick('--install-directory') || pick('--product-install-directory')
        resolve({ port, token, protocol: 'https', source: 'process', installDir: dir })
      }
    )
  })
}

/** 探测指定连接是否真的活着 */
async function verify(conn, timeout = 4000) {
  if (!conn) return null
  try {
    const { lcuRequest } = require('./api')
    const r = await lcuRequest(conn, '/lol-summoner/v1/current-summoner', { timeout })
    if (r.status !== 200 || !r.json) return null
    return { ...conn, summoner: r.json }
  } catch {
    return null
  }
}

/** 单飞去重：并发发现只跑一次，避免同时起多个 powershell */
let pendingDiscover = null

async function discover({ force = false } = {}) {
  if (!force && cache.conn && Date.now() - cache.at < CACHE_TTL) return cache.conn
  if (pendingDiscover) return pendingDiscover
  pendingDiscover = doDiscover({ force }).finally(() => {
    pendingDiscover = null
  })
  return pendingDiscover
}

async function doDiscover({ force = false } = {}) {
  // 1) 先试磁盘缓存（不需要任何权限，CLI 多次调用时就不会反复提权）
  if (!force) {
    const cached = readConnCache()
    if (cached) {
      const ok = await verify(cached)
      if (ok) {
        cache = { at: Date.now(), conn: ok }
        return ok
      }
    }
  }

  // 2) 常规发现：lockfile → 进程命令行
  let conn = fromLockfiles()
  if (!conn) conn = await fromProcess()
  if (!conn) {
    cache = { at: Date.now(), conn: null }
    return null
  }
  const ok = await verify(conn)
  if (ok) writeConnCache(ok)
  cache = { at: Date.now(), conn: ok }
  return ok
}

function invalidate() {
  cache = { at: 0, conn: null }
}

/**
 * 连不上时给出准确原因：
 * 国服（TCLS/WeGame）客户端的 lockfile 常常是 0 字节，凭据只在 LeagueClientUx.exe 的命令行里，
 * 而普通权限读不到该命令行 —— 这种情况必须提权。
 */
function diagnose() {
  const lfs = lockfileCandidates().map((f) => {
    let size = -1
    try {
      size = fs.statSync(f).size
    } catch {
      /* not found */
    }
    return { file: f, exists: size >= 0, size }
  })
  const present = lfs.filter((l) => l.exists && l.size > 0)
  const empty = lfs.filter((l) => l.exists && l.size === 0)

  let clientRunning = false
  let pid = null
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq LeagueClientUx.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout: 6000, windowsHide: true }
    )
    if (/LeagueClientUx\.exe/i.test(out)) {
      clientRunning = true
      const m = out.match(/"LeagueClientUx\.exe","(\d+)"/i)
      if (m) pid = Number(m[1])
    }
  } catch {
    /* tasklist 不可用时忽略 */
  }

  if (!clientRunning) {
    return {
      clientRunning: false,
      needsElevation: false,
      lockfile: present[0]?.file || empty[0]?.file || null,
      reason: '没检测到英雄联盟客户端，请先启动客户端并登录到大厅。',
    }
  }
  if (!present.length) {
    return {
      clientRunning: true,
      pid,
      needsElevation: true,
      lockfile: empty[0]?.file || null,
      reason:
        '客户端在运行，但 lockfile 为空（国服 TCLS 客户端常见），凭据只能从进程启动参数读取。请点「以管理员身份重启」，在 UAC 弹窗里选“是”。',
    }
  }
  return {
    clientRunning: true,
    pid,
    needsElevation: true,
    lockfile: present[0].file,
    reason: '检测到客户端但建立连接失败，尝试以管理员身份重启本工具。',
  }
}

module.exports = { discover, verify, invalidate, parseLockfile, lockfileCandidates, diagnose }
