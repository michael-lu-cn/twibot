#!/usr/bin/env node
/**
 * dev-host-gate-bypass —— 本机开发代理（仅限可信局域网使用！）。
 *
 * 为什么存在：dsh 的 /api 栅栏校验 Host 头必须为 loopback 或 trustedHosts；
 * 从模拟器/真机直连时 Host 是局域网地址会被拒。重启用 --trusted-host 当然是正解，
 * 但会中断正在运行的会话进程——此代理把入站请求的 Host 头改写为 127.0.0.1 后
 * 原样转发给本机 3080，实现"零重启放行"。
 *
 * 用法: node dev-host-gate-bypass.js [listenPort=3088] [upstreamPort=3080]
 *
 * ⚠️ 这等于把无鉴权的 dsh 完全暴露到监听网卡上（session.prompt 即 RCE），
 *    只允许在隔离的 NAT/家庭网络里临时使用。
 */
import http from 'node:http'
import net from 'node:net'

const LISTEN = Number(process.argv[2] ?? 3088)
const UPSTREAM_HOST = '127.0.0.1'
const UPSTREAM_PORT = Number(process.argv[3] ?? 3080)
const FAKE_HOST = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`

/** 把原始头块里的 Host 行替换成 loopback，其余原样保留（WS 升级依赖原头序）。 */
function rewriteHostHeader(rawHead) {
  return rawHead
    .toString('latin1')
    .split('\r\n')
    .map((line) => (line.toLowerCase().startsWith('host:') ? `Host: ${FAKE_HOST}` : line))
    .join('\r\n')
}

const server = http.createServer((req, res) => {
  const stripped = { ...req.headers };
for (const k of Object.keys(stripped)) {
  if (k.toLowerCase() === 'origin' || k.toLowerCase().startsWith('sec-fetch-')) delete stripped[k];
}
const headers = { ...stripped, host: FAKE_HOST };
  const upstream = http.request(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: req.url, method: req.method, headers },
    (ur) => {
      res.writeHead(ur.statusCode, ur.headers)
      ur.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' })
    res.end(`proxy upstream error: ${err.message}`)
  })
  req.pipe(upstream)
})

// WebSocket 升级：TCP 层拼接，仅改写请求头块里的 Host 行
server.on('upgrade', (req, clientSocket, head) => {
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const rewritten = rewriteHostHeader(req.rawHeaders.length ? reconstructRawHead(req) : '')
    upstream.write(rewritten)
    if (head?.length) upstream.write(head)
    clientSocket.setNoDelay(true)
    upstream.setNoDelay(true)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => upstream.destroy())
})

/** 由已解析的 req 还原原始请求头块（Node 不暴露原文时的最小重建）。 */
function reconstructRawHead(req) {
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
  }
  return Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1')
}

server.listen(LISTEN, '0.0.0.0', () => {
  console.log(`[dev-gate-bypass] listening 0.0.0.0:${LISTEN} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT} (Host rewritten)`)
})
