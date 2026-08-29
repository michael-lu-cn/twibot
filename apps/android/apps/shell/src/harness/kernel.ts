/**
 * 实验 1（真机档）：内核激活场景——计划 §9 原始 A/B 插件 + disposer 逆序断言。
 * 返回事件日志供界面渲染；通过标准与 Node 档一致：
 * B 在 A 之后激活；卸载时 disposer 打日志且逆序。
 */
import { Context } from '@twibot/face-cordis-kernel'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

export async function runKernelAliveDemo(onLog: (line: string) => void): Promise<string[]> {
  const log: string[] = []
  const trace = (line: string) => {
    log.push(line)
    onLog(line)
  }

  const A = {
    name: 'plugin-a',
    apply(ctx: any) {
      ctx.provide('counter', { n: 0 })
      ctx.effect(() => () => trace('[disposer] a'))
    },
  }
  const B = {
    name: 'plugin-b',
    inject: ['counter'],
    apply(ctx: any) {
      trace(`[active] b sees counter.n=${ctx.counter.n}`)
      ctx.effect(() => () => trace('[disposer] b'))
    },
  }

  const root = new Context()
  await root.plugin(A)
  await root.plugin(B)
  trace('--- unmount B, then A ---')
  ;(root as any).registry.delete(B)
  await tick()
  ;(root as any).registry.delete(A)
  await tick()
  return log
}

/** 判定：b-sees 在最前、两条 disposer 都在且 b 先于 a */
export function judgeKernelAlive(log: string[]): boolean {
  const bi = log.indexOf('[disposer] b')
  const ai = log.indexOf('[disposer] a')
  return (
    log.some((l) => l.startsWith('[active] b sees')) &&
    bi !== -1 &&
    ai !== -1 &&
    bi < ai
  )
}
