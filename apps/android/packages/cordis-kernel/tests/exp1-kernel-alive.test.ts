import { describe, expect, it } from 'vitest'
import { Context } from '../dist/cordis.kernel.js'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * 实验 1：Cordis 内核在纯 JS 运行时里活着（计划 §9 原始场景 + 响应式收敛加测）。
 * 通过标准：B 在 A 之后激活；卸载时 disposer 打日志且逆序。
 */
describe('实验 1：内核激活语义（vendored cordis 单文件产物）', () => {
  it('A provide counter → B inject 激活读到值；先卸 B 后卸 A 时 disposer 逆序', async () => {
    const log: string[] = []

    const A = {
      name: 'plugin-a',
      apply(ctx: any) {
        // provide 内部即 fiber.effect：随本 fiber 卸载自动回收
        ctx.provide('counter', { n: 0 })
        ctx.effect(() => () => log.push('disposed:a'))
      },
    }
    const B = {
      name: 'plugin-b',
      inject: ['counter'],
      apply(ctx: any) {
        log.push(`b-sees:${ctx.counter.n}`)
        ctx.effect(() => () => log.push('disposed:b'))
      },
    }

    const root = new Context()
    const fiberA = await root.plugin(A)
    const fiberB = await root.plugin(B)

    expect(log).toContain('b-sees:0')

    fiberB.dispose()
    await tick()
    fiberA.dispose()
    await tick()

    const bi = log.indexOf('disposed:b')
    const ai = log.indexOf('disposed:a')
    expect(bi, 'B 的 disposer 已执行').toBeGreaterThan(-1)
    expect(ai, 'A 的 disposer 已执行').toBeGreaterThan(-1)
    expect(bi < ai, `逆序：${JSON.stringify(log)}`).toBe(true)

    // 服务随提供者一起消失
    expect((root as any).counter).toBeUndefined()
  })

  it('依赖缺失时不激活；提供方就位后自动收敛激活（inject 响应式）', async () => {
    const log: string[] = []
    let release!: (ctx: Context) => void
    const gate = new Promise<Context>((r) => (release = r))

    // 提供方由外部触发，模拟"服务晚到"
    const LateProvider = {
      name: 'late-provider',
      apply(ctx: any) {
        ctx.provide('counter', { n: 7 })
        void gate.then(() => undefined)
      },
    }
    const Consumer = {
      name: 'consumer',
      inject: ['counter'],
      apply(ctx: any) {
        log.push(`activated:${ctx.counter.n}`)
      },
    }

    const root = new Context()
    // 关键：不 await Consumer 的 thenable——依赖未满足时它会停在 INACTIVE
    root.plugin(Consumer)
    await tick()
    expect(log, '缺依赖时保持未激活').toEqual([])

    await root.plugin(LateProvider)
    await tick()
    await tick()
    expect(log, '服务出现后自动激活').toEqual(['activated:7'])

    release(root)
    root.registry.delete(LateProvider)
    root.registry.delete(Consumer)
  })
})
