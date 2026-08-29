import { Context } from '@deepseek-ai/cordis'

/**
 * 智能分组：根据被关注者资料(bio) + 最近推文记录，按主题领域自动归类。
 *
 * 采用可解释的加权关键词分类器：
 * - bio 命中关键词 × 权重 2，最近推文命中 × 权重 1（累积、去重计数）
 * - 得分最高且 >0 的类别胜出；全部未命中 → 「其他」
 * - 中文内容作为独立信号：资料/推文以中文为主且无主题命中 → 「中文内容」
 * - 分类依据（matched）随结果返回，前端可展示，保证可解释与可调优
 *
 * 后续可平滑替换为 LLM 语义分类（同输出形状：groups[]）。关键词表按需扩展。
 */

export interface GroupMember {
  userId: string
  handle: string
  name: string
  avatarUrl: string
  bio: string
  tweetCount: number
  /** 最近一条推文摘要（分类依据可见性）。 */
  recentSample: string
  /** 命中的关键词（按权重：bio 优先）。 */
  matched: string[]
}

export interface GroupInfo {
  id: string
  name: string
  users: GroupMember[]
}

export interface SmartGroupsResult {
  groups: GroupInfo[]
  /** 未归入任何主题组（含中文组）的用户数量。 */
  otherCount: number
  total: number
  generatedAt: number
}

interface GroupDef {
  id: string
  name: string
  /** 英文关键词：\b 词边界匹配（lowercase 后）。 */
  en: string[]
  /** 中文关键词：子串匹配。 */
  zh: string[]
}

const GROUP_DEFS: GroupDef[] = [
  {
    id: 'ai',
    name: 'AI / 机器学习',
    en: ['llm', 'gpt', 'neural', 'machine learning', 'deep learning', 'agi', 'artificial intelligence', 'diffusion', 'multimodal', 'rag'],
    zh: ['人工智能', '大模型', '机器学习', '深度学习', '智能体', '提示词'],
  },
  {
    id: 'dev',
    name: '开发 / 开源',
    en: ['developer', 'programming', 'software engineer', 'open source', 'opensource', 'github', 'rust', 'golang', 'typescript', 'javascript', 'python', 'kubernetes', 'linux', 'compiler', 'programmer', 'startup engineer'],
    zh: ['开发', '程序员', '开源', '工程师', '代码', '编程'],
  },
  {
    id: 'startup',
    name: '创业 / 风险投资',
    en: ['startup', 'founder', 'venture', 'entrepreneur', 'investor', 'yzc', 'startups'],
    zh: ['创业', '创始人', '融资', '投资人', '风险投资'],
  },
  {
    id: 'finance',
    name: '财经 / 市场',
    en: ['finance', 'stock market', 'trading', 'investing', 'financial', 'equities', 'macroeconomics'],
    zh: ['财经', '股市', '金融', '投资', '宏观经济', '证券'],
  },
  {
    id: 'crypto',
    name: 'Web3 / 加密',
    en: ['bitcoin', 'ethereum', 'web3', 'blockchain', 'solana', 'defi', 'nft', 'crypto'],
    zh: ['比特币', '以太坊', '区块链', '加密', '币圈', '数字资产'],
  },
  {
    id: 'design',
    name: '设计 / 产品',
    en: ['designer', 'product design', 'figma', 'ux', 'ui designer', 'typography'],
    zh: ['设计', '产品经理', '交互设计', '用户体验'],
  },
  {
    id: 'media',
    name: '媒体 / 新闻',
    en: ['journalist', 'reporter', 'newsletter', 'news media', 'editor', 'columnist', 'tech media'],
    zh: ['记者', '媒体', '新闻', '主编', '报道', '撰稿人'],
  },
  {
    id: 'academic',
    name: '学术 / 研究',
    en: ['researcher', 'phd', 'professor', 'scientist', 'research', 'paper', 'lab'],
    zh: ['教授', '博士', '研究员', '科研', '论文', '实验室'],
  },
]

/** 中文比例判定阈值（cjk 字符占可见字符比）。 */
const CJK_RATIO = 0.25
const CJK_RE = /[\u4e00-\u9fff]/g

/** 单段文本对某个类别命中关键词（去重）。 */
function hitsIn(def: GroupDef, text: string, lower: string): string[] {
  const hits: string[] = []
  for (const w of def.en) {
    if (new RegExp(`\\b${escapeRe(w)}\\b`).test(lower)) hits.push(w)
  }
  for (const w of def.zh) {
    if (text.includes(w)) hits.push(w)
  }
  return hits
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 中文占比。 */
function cjkRatio(text: string): number {
  const matches = text.match(CJK_RE)
  if (!matches) return 0
  const visible = text.replace(/\s/g, '').length
  return visible ? matches.length / visible : 0
}

/** 分类一个用户：返回 { groupId, matched }。 */
export function classifyUser(bio: string, recentTweets: string[]): { groupId: string; matched: string[] } {
  const lower = bio.toLowerCase()
  const tweetsLower = recentTweets.join(' ').toLowerCase()
  const bioCjk = cjkRatio(bio)
  const tweetCjk = recentTweets.length > 0 ? cjkRatio(recentTweets.join(' ')) : 0

  let best: { id: string; score: number; matched: string[] } | null = null
  for (const def of GROUP_DEFS) {
    let score = 0
    const matched: string[] = []
    // bio 权重 2
    const bioHits = hitsIn(def, bio, lower)
    if (bioHits.length > 0) {
      score += bioHits.length * 2
      matched.push(...bioHits)
    }
    // 最近推文权重 1
    const tweetHits = hitsIn(def, recentTweets.join(' '), tweetsLower)
    if (tweetHits.length > 0) {
      score += tweetHits.length
      matched.push(...tweetHits)
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { id: def.id, score, matched }
    }
  }

  if (best) return { groupId: best.id, matched: best.matched }

  // 中文内容兜底：资料或推文以中文为主
  const zhish = bioCjk >= CJK_RATIO || tweetCjk >= CJK_RATIO
  if (zhish) return { groupId: 'chinese', matched: ['中文内容'] }

  return { groupId: 'other', matched: [] }
}

export const name = 'smart-groups'
export const inject = ['store', 'api']

export interface Config {}

export function apply(ctx: Context, config: Config): void {
  const store = ctx.store as any
  const api = ctx.api as any

  api.get('/api/groups/auto', (c: any) => {
    const handle = store.kvGet('current_handle')
    if (!handle) {
      return c.json({ ok: false, error: { code: 'NO_ME', message: '尚未识别当前登录账号，请先同步一次关注列表' } }, 404)
    }
    const me = store.getUserByHandle(handle)
    if (!me) {
      return c.json({ ok: false, error: { code: 'NOT_SYNCED', message: '本地还没有关注列表，请先同步' } }, 404)
    }
    const users = store.getFollowingUsers(me.id, 5000) as Array<{ id: string; handle: string; name: string; bio: string; avatarUrl: string }>

    const groups = new Map<string, GroupInfo>(GROUP_DEFS.map((g) => [g.id, { id: g.id, name: g.name, users: [] }]))
    groups.set('chinese', { id: 'chinese', name: '中文内容', users: [] })

    let otherCount = 0
    for (const u of users) {
      const rows = store.listUserTweets(u.id, 20) as Array<{
        tweet?: { text: string; createdAt: string } | null
      }>
      const recentTweets = rows.map((r) => r.tweet?.text ?? '').filter(Boolean)
      const { groupId, matched } = classifyUser(u.bio ?? '', recentTweets)
      const member: GroupMember = {
        userId: u.id,
        handle: u.handle,
        name: u.name,
        avatarUrl: u.avatarUrl,
        bio: u.bio ?? '',
        tweetCount: recentTweets.length,
        recentSample: recentTweets[0]?.slice(0, 80) ?? '',
        matched,
      }
      if (groupId === 'other') {
        otherCount++
        continue
      }
      groups.get(groupId)?.users.push(member)
    }

    // 按人数降序，空组剔除
    const result: GroupInfo[] = [...groups.values()]
      .filter((g) => g.users.length > 0)
      .sort((a, b) => b.users.length - a.users.length)

    return c.json({
      ok: true,
      data: { groups: result, otherCount, total: users.length, generatedAt: Date.now() } satisfies SmartGroupsResult,
      source: 'smart-groups',
      elapsedMs: 0,
    })
  })
}