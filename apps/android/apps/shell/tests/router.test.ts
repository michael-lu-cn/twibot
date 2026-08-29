/**
 * A2: 路由纯函数（对齐 web 版 lib/router.ts 语义）。
 * 覆盖：path 解析、Route→path、深链双向转换、未知回退。
 */
import { describe, expect, it } from 'vitest'

import { deepLinkToPath, parseRoutePath, routeToDeepLink, routeToPath } from '../src/lib/router'

describe('parseRoutePath', () => {
  it('五个页签 + 空串 + 未知回退', () => {
    expect(parseRoutePath('/bookmarks')).toEqual({ tab: 'bookmarks' })
    expect(parseRoutePath('/following')).toEqual({ tab: 'following' })
    expect(parseRoutePath('/groups')).toEqual({ tab: 'groups' })
    expect(parseRoutePath('/auth')).toEqual({ tab: 'auth' })
    expect(parseRoutePath('')).toEqual({ tab: 'home' })
    expect(parseRoutePath('/')).toEqual({ tab: 'home' })
    expect(parseRoutePath('/nonsense')).toEqual({ tab: 'home' })
  })

  it('用户主页：users/<handle> → userHandle', () => {
    expect(parseRoutePath('/users/foo_bar')).toEqual({ tab: 'home', userHandle: 'foo_bar' })
    expect(parseRoutePath('/users/')).toEqual({ tab: 'home' })
    // 中文 handle（实际少见）经 encodeURIComponent 往返
    expect(parseRoutePath('/users/%E6%B5%8B%E8%AF%95')).toEqual({ tab: 'home', userHandle: '测试' })
  })

  it('多余段忽略后续', () => {
    expect(parseRoutePath('/bookmarks/extra')).toEqual({ tab: 'bookmarks' })
  })
})

describe('routeToPath / routeToDeepLink', () => {
  it('页签与用户双向', () => {
    expect(routeToPath({ tab: 'bookmarks' })).toBe('/bookmarks')
    expect(routeToPath({ tab: 'home', userHandle: 'a/b' })).toBe('/users/a%2Fb')
    expect(routeToDeepLink({ tab: 'groups' })).toBe('twibot://groups')
    expect(routeToDeepLink({ tab: 'home', userHandle: 'foo' })).toBe('twibot://users/foo')
  })

  it('深链 → path 与非法 scheme', () => {
    expect(deepLinkToPath('twibot://bookmarks')).toBe('/bookmarks')
    expect(deepLinkToPath('twibot://users/foo')).toBe('/users/foo')
    expect(deepLinkToPath('https://x.com/home')).toBeNull()
    expect(deepLinkToPath('twibot://')).toBe('/')
  })
})