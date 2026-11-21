'use strict'
/** LCU 本地 HTTPS 客户端（自签证书，Basic 认证） */
const https = require('node:https')

const AGENT = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 8 })

function lcuRequest(conn, apiPath, { method = 'GET', body = null, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    if (!conn || !conn.port) {
      return resolve({ status: 0, json: null, text: '', error: 'no-connection' })
    }
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8')
    const req = https.request(
      {
        host: '127.0.0.1',
        port: conn.port,
        path: apiPath,
        method,
        agent: AGENT,
        timeout,
        headers: {
          Authorization:
            'Basic ' + Buffer.from(`riot:${conn.token}`, 'utf8').toString('base64'),
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          const text = buf.toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch {
            /* 非 JSON 响应（图片/纯文本） */
          }
          resolve({ status: res.statusCode || 0, json, text, headers: res.headers })
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, json: null, text: '', error: 'timeout' })
    })
    req.on('error', (e) => resolve({ status: 0, json: null, text: '', error: e.message }))
    if (payload) req.write(payload)
    req.end()
  })
}

/** 拉二进制（皮肤贴图等） */
function lcuBinary(conn, apiPath, timeout = 20000) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: conn.port,
        path: apiPath,
        method: 'GET',
        agent: AGENT,
        timeout,
        headers: {
          Authorization: 'Basic ' + Buffer.from(`riot:${conn.token}`, 'utf8').toString('base64'),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            buffer: Buffer.concat(chunks),
            contentType: res.headers['content-type'] || 'application/octet-stream',
          })
        )
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, buffer: null })
    })
    req.on('error', () => resolve({ status: 0, buffer: null }))
    req.end()
  })
}

module.exports = { lcuRequest, lcuBinary }
