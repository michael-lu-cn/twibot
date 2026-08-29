import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '../dist/cordis.kernel.js'

/**
 * 实验 0：引擎命门冒烟（计划 §9 新增实验）。
 * Proxy 是 Context 的承重结构：所有服务解析走 ReflectService.handler 单个 get/set trap。
 * 本文件在 Node 上验证"测试基线 + 产物补丁"；Hermes/JSC 档由 apps/shell 的同款 harness 在真机执行。
 */
describe('实验 0：Context Proxy trap 语义与补丁包', () => {
  it('构造即返回 Proxy，内置五服务齐全', () => {
    const ctx = new Context()
    expect(Context.is(ctx)).toBe(true)
    expect(ctx.registry).toBeTruthy()
    expect(ctx.events).toBeTruthy()
    expect(ctx.logger).toBeTruthy()
    expect(ctx.reflect).toBeTruthy()
    expect((ctx as any).root).toBe(ctx)
  })

  it('get trap：未提供服务读取返回 undefined 而不抛错', () => {
    const ctx = new Context()
    expect((ctx as any).noSuchServiceAnywhere).toBeUndefined()
  })

  it('provide → 可读；disposer → 回到 undefined；重复 provide 同名抛错', () => {
    const ctx = new Context()
    const dispose = (ctx as any).provide('gadget', { n: 42 })
    expect((ctx as any).gadget).toEqual({ n: 42 })
    dispose()
    expect((ctx as any).gadget).toBeUndefined()

    ;(ctx as any).provide('gadget2', 1)
    expect(() => (ctx as any).provide('gadget2', 2)).toThrow(/has been registered/)
  })

  it('set trap：插件 fiber 内未 provide 赋值抛错；root 壳（无 runtime）允许', async () => {
    const root = new Context()
    // root fiber 无 runtime：壳层可自由挂属性
    expect(() => ((root as any).shellProp = 1)).not.toThrow()

    const Bad = {
      name: 'bad-plugin',
      apply(ctx: any) {
        ctx.ghost = 1
      },
    }
    // 插件 fiber 有 runtime：纪律生效
    await expect(root.plugin(Bad)).rejects.toThrow(/without provide/)
  })

  it('事件派发四种模式可用（emit/waterfall/parallel/serial）', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.on('test/event' as any, (n: number) => seen.push(`emit:${n}`))
    ;(ctx as any).emit('test/event', 1)
    await tick()
    expect(seen).toContain('emit:1')
  })

  it('WeakRef/Object.hasOwn 在本引擎可用，且 banner 补丁位于产物头部', async () => {
    expect(typeof WeakRef).toBe('function')
    expect(Object.hasOwn({ a: 1 }, 'a')).toBe(true)
    const src = readFileSync(fileURLToPath(new URL('../dist/cordis.kernel.js', import.meta.url)), 'utf8')
    expect(src.slice(0, 60)).toContain("typeof globalThis.WeakRef !== 'function'")
  })
})

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
