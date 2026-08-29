/**
 * @twibot/face-cordis-kernel 的最小类型面（vendored cordis 只交付单文件 JS 产物，无 .d.ts）。
 *
 * 纯环境模块声明：不参与相对路径导入，类型一律从 '@twibot/face-cordis-kernel' 取。
 * 只声明本壳用到的部分：Context / 插件形状 / provide / effect / registry /
 * 注入服务属性（ctx.dsh、ctx.sessions 经字符串索引签名读取）。
 */

declare module '@twibot/face-cordis-kernel' {
  /** 对象插件形状（函数/类插件本壳不用）。 */
  export interface CordisPlugin {
    name?: string
    /** 依赖的服务名列表；内核在全部可用后才激活 apply。 */
    inject?: readonly string[]
    /** 插件体：deps 就绪后调用；config 为 ctx.plugin(plugin, config) 传入。 */
    apply(ctx: CordisContext, config?: unknown): unknown
  }

  export interface CordisFiber {
    readonly name: string
    readonly state: number
  }

  export class Context {
    constructor()
    /** Context.is(ctx)：跨 realm 的品牌校验（函数本体经 Symbol.toPrimitive 兼作属性键）。 */
    static is(value: unknown): boolean
    /**
     * 在当前上下文启动插件，返回可等待的 fiber 句柄
     * （await 它 = 该插件的加载流程收敛）。
     */
    plugin(plugin: CordisPlugin, config?: Record<string, unknown>): PromiseLike<CordisFiber>
    /** 注册服务；返回注销器（随 fiber 卸载自动执行）。 */
    provide(name: string, value: unknown): () => void
    /** 登记副作用清理；fiber 卸载时逆序执行返回的 disposer。 */
    effect(execute: () => (() => void | Promise<void>) | void, label?: string): () => void
    /** 运行时注册表：delete(插件) = 卸载其全部 fiber（触发 effect 回滚）。 */
    readonly registry: {
      has(plugin: unknown): boolean
      delete(plugin: unknown): unknown
    }
    /** cordis 服务即 ctx 属性：ctx.dsh、ctx.sessions 等经此读取。 */
    [key: string]: unknown
  }

  /** apply 收到的 ctx：根 Context 的子代理（服务经属性注入）。 */
  export interface CordisContext extends Context {}
}
