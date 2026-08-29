/**
 * 实验 0（真机引擎档）：Context Proxy trap 冒烟。
 * 与 packages/cordis-kernel/tests/exp0-proxy-smoke.test.ts 同一套断言，
 * 但不依赖 vitest——在 RN 运行时里直接返回结构化结果供界面渲染。
 * 通过标准：全部 pass=true；任何一项 fail 即触发判定树"实验 0 死"分支。
 */
import { Context } from '@twibot/face-cordis-kernel'

export interface Check {
  name: string
  pass: boolean
  detail?: string
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message)
}

export type CheckFn = () => void | string | Promise<void | string>

/** 同步用例返回 Check；异步用例（返回 Promise）返回 Promise<Check>，拒绝即 fail。 */
export function checkAsync(name: string, fn: CheckFn): Check | Promise<Check> {
  try {
    const detail = fn()
    if (typeof (detail as Promise<unknown>)?.then === 'function') {
      return (detail as Promise<void | string>).then(
        (value) => ({ name, pass: true, detail: typeof value === 'string' ? value : undefined }),
        (e: unknown) => ({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }),
      )
    }
    return { name, pass: true, detail: typeof detail === 'string' ? detail : undefined }
  } catch (e) {
    return { name, pass: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** 同步可判定的引擎与内核语义检查 */
export function runEngineSmoke(): Check[] {
  const out: Check[] = []
  // 冒烟用例全是同步的：局部 check 收窄为直接产出 Check，误传异步在此显式失败而非静默吞掉。
  const check = (name: string, fn: () => void | string): Check => {
    const result = checkAsync(name, fn)
    if (result instanceof Promise || typeof (result as unknown as Promise<unknown>)?.then === 'function') {
      throw new Error(`smoke check "${name}" must be synchronous`)
    }
    return result
  }

  out.push(
    check('WeakRef 可用（原生或 banner 补全）', () => {
      assert(typeof WeakRef === 'function', 'typeof WeakRef !== function')
      const r = new WeakRef({ x: 1 }) as { deref(): { x: number } | undefined }
      assert(r.deref()?.x === 1, 'deref() 失效')
    }),
  )

  out.push(
    check('Object.hasOwn 可用', () => {
      assert(Object.hasOwn({ a: 1 }, 'a'), 'hasOwn 判定失败')
    }),
  )

  out.push(
    check('Context 构造即 Proxy，内置服务齐全', () => {
      const ctx = new Context() as any
      assert(Context.is(ctx), 'Context.is 品牌校验失败')
      for (const key of ['registry', 'events', 'logger', 'reflect']) {
        assert(ctx[key] != null, `ctx.${key} 缺失`)
      }
      assert(ctx.root === ctx, 'root 代理同一性失败')
    }),
  )

  out.push(
    check('get trap：未服务读取 → undefined 不抛错', () => {
      const ctx = new Context() as any
      assert(ctx.__no_such_service__ === undefined, '应返回 undefined')
    }),
  )

  out.push(
    check('provide/dispose 服务生命周期', () => {
      const ctx = new Context() as any
      const dispose = ctx.provide('gadget', { n: 42 })
      assert(ctx.gadget?.n === 42, 'provide 后不可读')
      dispose()
      assert(ctx.gadget === undefined, 'dispose 后未回收')
    }),
  )

  return out
}

/**
 * set-trap 的插件 fiber 守卫断言（异步：apply 内抛错使 fiber rejected）。
 * 通过 = rejects 且信息匹配 /without provide/。
 */
export async function runSetTrapCheck(): Promise<Check> {
  return checkAsync('set trap：插件 fiber 内未 provide 赋值抛错', async () => {
    const root = new Context() as any
    // root 壳无 runtime：允许自由赋值
    root.shellProp = 1
    assert(root.shellProp === 1, 'root 壳赋值应放行')

    const Bad = {
      name: 'bad-plugin',
      apply(c: any) {
        c.ghost = 1
      },
    }
    let rejected: unknown = null
    try {
      await root.plugin(Bad)
    } catch (e) {
      rejected = e
    }
    assert(rejected != null, '插件内越权赋值未被拒绝')
    assert(/without provide/.test(String((rejected as Error)?.message ?? rejected)), '错误信息不匹配')
  })
}
