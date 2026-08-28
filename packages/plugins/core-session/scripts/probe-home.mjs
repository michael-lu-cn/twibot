/** 探查真实 HomeTimeline 响应结构(诊断用):抓第一条 entry 的原样 JSON。 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const raw = readFileSync('/home/grant/orca/projects/twibot/apps/api/data/credential.cookie', 'utf8')
const cookieStr = raw.includes("'") && raw.includes('-b')
  ? (raw.match(/-b '([^']*)'/)?.[1] ?? '')
  : raw
const cookies = cookieStr.split(';').map((p) => {
  const eq = p.indexOf('=')
  return { name: p.slice(0, eq).trim(), value: p.slice(eq + 1).trim(), domain: '.x.com', path: '/' }
})

const browser = await chromium.launch({ headless: true, proxy: { server: 'http://172.16.74.1:7890' } })
const context = await browser.newContext({ locale: 'en-US', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' })
await context.addCookies(cookies)
const page = await context.newPage()
page.on('response', async (res) => {
  const u = res.url()
  if (!u.includes('/graphql/') || !u.includes('HomeTimeline') || u.includes('HomeLatestTimeline')) return
  try {
    const j = await res.json()
    const home = j?.data?.home ?? {}
    console.log('HOME keys:', Object.keys(home))
    const urt = home?.home_timeline_urt ?? {}
    console.log('URT keys:', Object.keys(urt))
    const timeline = urt?.timeline ?? home?.timeline
    console.log('timeline keys:', timeline ? Object.keys(timeline) : null)
    const instructions = timeline?.instructions ?? []
    console.log('instructions:', instructions.length)
    for (const instr of instructions) {
      for (const e of instr.entries ?? []) {
        const c = e.content ?? {}
        if (c.entryType === 'TimelineTimelineItem' && c.itemContent?.tweet_results) {
          const r = c.itemContent.tweet_results.result
          console.log('entryType:', c.entryType, '| itemContent type:', c.itemContent.__typename, '| result typename:', r?.__typename, '| rest_id:', r?.rest_id)
          console.log('  result keys:', Object.keys(r ?? {}))
          console.log('  legacy keys:', r?.legacy ? Object.keys(r.legacy) : null)
          const u = r?.core?.user_results?.result
          console.log('  user keys:', u ? Object.keys(u) : null, '| user.core:', u?.core ? Object.keys(u.core) : null, '| user.legacy:', u?.legacy ? Object.keys(u.legacy) : null)
          console.log('  sample:', JSON.stringify(r?.core?.user_results?.result?.legacy ?? {}).slice(0, 200))
          await browser.close(); process.exit(0)
        }
      }
    }
    console.log('no tweet entry found')
    const entries = instructions.flatMap((i) => i.entries ?? []) ?? []
    const first = entries.find((e) => e.content?.itemContent?.tweet_results?.result)
    if (first) {
      const result = first.content.itemContent.tweet_results.result
      const resultKeys = Object.keys(result)
      const legacy = result.legacy ? Object.keys(result.legacy) : null
      const user = result.core?.user_results?.result
      const userKeys = user ? Object.keys(user) : null
      const coreKeys = user?.core ? Object.keys(user.core) : null
      const userLegacyKeys = user?.legacy ? Object.keys(user.legacy) : null
      console.log('RESULT keys:', resultKeys)
      console.log('legacy keys:', legacy)
      console.log('user keys:', userKeys)
      console.log('user.core keys:', coreKeys)
      console.log('user.legacy keys:', userLegacyKeys)
      console.log('tweet path:', j.data.home ? Object.keys(j.data.home) : 'none')
      console.log('sample author core:', JSON.stringify(user?.core).slice(0, 300))
      console.log('sample author legacy:', JSON.stringify(user?.legacy).slice(0, 300))
      await browser.close()
      process.exit(0)
    }
  } catch (e) {
    console.log('parse err', e.message)
  }
})
console.log('cookies:', cookies.length)
await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('goto err', e.message))
console.log('url:', page.url())
await new Promise(r => setTimeout(r, 8000))
console.log('title:', await page.title().catch(() => ''))
console.log('body head:', (await page.evaluate(() => document.body?.innerText?.slice(0, 150) ?? '').catch(() => '')).replace(/\n/g, ' '))
setTimeout(() => { console.log('timeout'); browser.close(); process.exit(0) }, 60000)