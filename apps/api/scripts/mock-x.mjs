/** 本地 mock X：验证 sync-feed / sync-following 全链路（解析/过滤/落库），无需外网。 */
import http from 'node:http'

// ─── mock 关注用户（新版 User 结构）───
const mockUsers = [
  { rest_id: 'fu-1', screen_name: 'alice', name: 'Alice Chen', bio: '前端工程师 · 咖啡因驱动', image_url: 'https://pbs.twimg.com/profile_images/alice.jpg' },
  { rest_id: 'fu-2', screen_name: 'bob_zhang', name: 'Bob Zhang', bio: '独立开发者', image_url: 'https://pbs.twimg.com/profile_images/bob.jpg' },
  { rest_id: 'fu-3', screen_name: 'carol', name: 'Carol Li', bio: '', image_url: 'https://pbs.twimg.com/profile_images/carol.jpg' },
  { rest_id: 'fu-4', screen_name: 'dave', name: 'Dave Wang', bio: 'Open source ❤', image_url: 'https://pbs.twimg.com/profile_images/dave.jpg' },
  { rest_id: 'fu-5', screen_name: 'erin', name: 'Erin Xu', bio: '设计 · 滑雪', image_url: 'https://pbs.twimg.com/profile_images/erin.jpg' },
].map((u) => ({
  content: {
    entryType: 'TimelineTimelineItem',
    itemContent: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: u.rest_id,
          core: { name: u.name, screen_name: u.screen_name },
          profile_bio: { description: u.bio },
          avatar: { image_url: u.image_url },
        },
      },
    },
  },
}))

// 当前登录用户（书签页侧边栏；mock 固定 mockuser + 关注总数 5）
const ME_HANDLE = 'mockuser'
const ME_UID = 'me-0'

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
  // 关注列表：Following GraphQL 响应（新版 envelope: data.user.result.timeline.timeline.instructions）
  if (url.includes('/graphql/') && url.includes('Following')) {
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        data: {
          user: {
            result: {
              rest_id: ME_UID,
              timeline: { timeline: { instructions: [{ entries: mockUsers }] } },
            },
          },
        },
      }),
    )
    return
  }
  // 推荐流：HomeTimeline GraphQL 响应
  if (url.includes('/graphql/') && url.includes('HomeTimeline') && !url.includes('HomeLatestTimeline')) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: { home: { timeline: { instructions: [{ entries }] } } } }))
    return
  }
  // 书签页（resolveCurrentHandle 的 DOM 探测）
  if (url.startsWith('/i/bookmarks')) {
    res.setHeader('content-type', 'text/html')
    res.end(
      `<!doctype html><html><body><div data-testid="SideNav_AccountSwitcher_Button">twibot mock<svg/><span>@${ME_HANDLE}</span></div></body></html>`,
    )
    return
  }
  // 关注页（加载后自己请求 Following GraphQL）
  if (url.endsWith('/following')) {
    res.setHeader('content-type', 'text/html')
    res.end(
      `<!doctype html><html><body><h1>${ME_HANDLE} following</h1><script>fetch("/graphql/Following?x=1").catch(()=>{})</script><div data-testid="UserCell">mock cell</div></body></html>`,
    )
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