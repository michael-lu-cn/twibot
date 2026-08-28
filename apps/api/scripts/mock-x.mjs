/** 本地 mock X：验证 sync-feed 全链路（解析/广告过滤/转推解包/落库），无需外网。 */
import http from 'node:http'

const t = (id, restId, text, extra = {}) => ({
  content: {
    entryType: 'TimelineTimelineItem',
    itemContent: {
      tweet_results: {
        result: {
          __typename: 'Tweet',
          rest_id: restId,
          core: {
            user_results: { result: { rest_id: `user-${id}`, core: { name: `User ${id}`, screen_name: `user${id}` }, legacy: { name: `User ${id}`, screen_name: `user${id}` } } },
          },
          legacy: {
            full_text: text,
            created_at: '2026-08-28T10:00:00.000Z',
            favorite_count: 10,
            retweet_count: 2,
            reply_count: 1,
            ...extra,
          },
          views: { count: '99' },
        },
      },
    },
  },
})

const entries = [
  t(1, '111', 'hello from mock feed'),
  // 广告：promotedMetadata 存在 → 应被过滤
  { content: { entryType: 'TimelineTimelineItem', itemContent: { promotedMetadata: { advertiser: 'x' }, tweet_results: { result: { __typename: 'Tweet', rest_id: '222', legacy: { full_text: 'ad' } } } } } },
  // 转推：应解包到原文
  t(5, '555', 'brand new tweet'),
  t(3, '333', 'outer text', {
    retweeted_status_result: { result: { __typename: 'Tweet', rest_id: '444', legacy: { full_text: 'inner retweet text', created_at: '2026-08-28T09:00:00.000Z' } } },
  }),
]

const server = http.createServer((req, res) => {
  const url = req.url ?? '/'
  if (url.includes('/graphql/') && url.includes('HomeTimeline') && !url.includes('HomeLatestTimeline')) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: { home: { timeline: { instructions: [{ entries }] } } } }))
    return
  }
  if (url.startsWith('/home') || url === '/') {
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><html><body><h1>mock x</h1><script>fetch("/graphql/HomeTimeline?x=1").catch(()=>{})</script></body></html>')
    return
  }
  res.setHeader('content-type', 'application/json')
  res.end('{}')
})
server.listen(18999, () => console.log('mock x on 18999'))