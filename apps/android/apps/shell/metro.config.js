/**
 * Metro 配置:在 Expo 默认配置上叠加插件 chunk 服务路由。
 *
 * 统一服务原则:设备侧一切资源走 metro.dsh.port.dpdns.org 一个入口——
 * 主 bundle、/reload 热重载、以及 /plugins/ 下的远端插件 chunk 与清单。
 * chunk 产物由 scripts/build-chunk.sh 预构建到 apps/remote-chunk-demo/dist/,
 * 这里只做静态服务与 rev 清单;构建本身不进请求路径。
 */
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

const config = getDefaultConfig(__dirname)

const CHUNK_DIR = path.resolve(__dirname, '../remote-chunk-demo/dist')

function chunkManifest() {
  const entries = []
  for (const file of fs.readdirSync(CHUNK_DIR)) {
    if (!file.endsWith('.client.js')) continue
    const body = fs.readFileSync(path.join(CHUNK_DIR, file))
    const rev = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12)
    entries.push({ id: file.replace(/\.client\.js$/, ''), url: `/plugins/${file}?rev=${rev}`, rev })
  }
  return { entries }
}

config.server = {
  ...config.server,
  /**
   * 新版 Expo/Metro:enhanceMiddleware 收到的是裸请求处理函数(非 Connect app),
   * 用法 = 返回一个包装函数:先处理 /plugins/*,其余交还 Metro。
   */
  enhanceMiddleware(metroMiddleware) {
    return function pluginsMiddleware(req, res, next) {
      if (req.method === 'GET' && req.url.startsWith('/plugins/')) {
        const url = new URL(req.url, 'http://local')
        const name = url.pathname.replace(/^\/plugins\//, '')
        if (name === 'manifest.json') {
          const body = Buffer.from(JSON.stringify(chunkManifest()))
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length) })
          res.end(body)
          return
        }
        // 白名单形态校验:仅允许 <name>.client.js,拒绝路径穿越与任意后缀。
        if (/^[\w.-]+\.client\.js$/.test(name)) {
          const full = path.join(CHUNK_DIR, name)
          if (fs.existsSync(full)) {
            // 显式 content-length:多层代理链(CF→tunnel→portless)对流式
            // 无长度响应会挂起,整读+定长最稳(chunk 都是 KB 级)。
            const body = fs.readFileSync(full)
            res.writeHead(200, { 'content-type': 'application/javascript', 'content-length': String(body.length) })
            res.end(body)
            return
          }
        }
      }
      metroMiddleware(req, res, next)
    }
  },
}

module.exports = config
