'use strict'
/**
 * 只读审计：确认项目里没有任何「启动英雄联盟客户端」的代码
 *
 * 设计原则（用户定的）：
 *   本项目只读 LCU 数据，客户端必须由用户自己启动。
 *   不允许出现 启动 / 拉起 / 重启 客户端 的任何调用。
 *
 * 允许的"进程调用"只有三类：
 *   1. 查进程（Get-CimInstance / tasklist）—— 只读
 *   2. 重启本应用（Start-Process ${process.execPath}）—— 提权读凭据
 *   3. 打开外部链接（shell.openExternal，仅 https?:）
 *
 * 用法：node tools/audit_readonly.js
 *   退出码 0 = 干净，1 = 发现可疑调用
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOTS = ['core', 'cli', 'electron', 'src', 'tools']
const EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ps1', '.psm1'])

/** 危险模式：同时出现「启动动作」和「客户端目标」 */
const DANGER = [
  // PowerShell 启动客户端
  { re: /Start-Process[^\n\r]*?(LeagueClient|TCLS|WeGame|RiotClient)[^\n\r]*/i, why: 'PowerShell 启动客户端' },
  // Node 子进程启动客户端
  { re: /(spawn|spawnSync|exec|execFile|execSync|execFileSync)\s*\(\s*[`'"][^`'"]*(LeagueClient|TCLS)[^`'"]*[`'"]/i, why: 'child_process 启动客户端' },
  // openExternal 打开客户端
  { re: /openExternal\s*\(\s*[^)]*(LeagueClient|TCLS)[^)]*\)/i, why: 'openExternal 打开客户端' },
  // 直接引用客户端可执行文件
  { re: /[`'"][^`'"\n]*LeagueClient\.exe[`'"]/i, why: '引用 LeagueClient.exe' },
  { re: /[`'"][^`'"\n]*LeagueClientUx\.exe[`'"]/i, why: '引用 LeagueClientUx.exe' },
]

/** 白名单：这些行是只读用途，允许 */
const SAFE_LINE = [
  /Get-CimInstance/i, // 查进程
  /tasklist/i, // 查进程
  /CommandLine/i, // 读命令行
  /IMAGENAME/i, // tasklist 过滤
  /Name='LeagueClientUx\.exe'/i, // CIM 过滤条件
  /Launcher|launcher/i, // 启动器路径常量（只用于找 lockfile）
]

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.tmp' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (EXTS.has(path.extname(e.name))) out.push(p)
  }
  return out
}

const findings = []
const files = []
for (const r of ROOTS) files.push(...walk(path.join(__dirname, '..', r)))

for (const file of files) {
  if (path.resolve(file) === path.resolve(__filename)) continue // 跳过本审计脚本自身
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = text.split(/\r?\n/)
  lines.forEach((line, idx) => {
    if (SAFE_LINE.some((s) => s.test(line))) return
    for (const d of DANGER) {
      if (d.re.test(line)) {
        findings.push({
          file: path.relative(path.join(__dirname, '..'), file),
          line: idx + 1,
          why: d.why,
          code: line.trim().slice(0, 120),
        })
        break
      }
    }
  })
}

console.log(`扫描 ${files.length} 个文件`)
if (!findings.length) {
  console.log('✅ 干净：没有任何启动客户端的调用')
  process.exit(0)
}
console.log(`\n❌ 发现 ${findings.length} 处可疑调用：\n`)
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  [${f.why}]`)
  console.log(`     ${f.code}`)
}
console.log('\n本项目只允许读取 LCU 数据，客户端必须由用户自己启动。')
process.exit(1)
