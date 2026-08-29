/**
 * 远端插件 chunk 示例（实验 4 的"手机上出现的新 UI"）。
 * 构建为独立 chunk 后放到宿主可服务的位置，由壳内按钮触发 loadScript('demo-greeter')。
 *
 * 约定导出：register(slotId, render, { priority }) —— 对齐 @twibot/face-priority-slot 语义；
 * 动态插件用页内唯一 rank（上游 guard allocatePriority 的行为），这里演示固定值。
 */
export function register(slotCore, { priority = 1 } = {}) {
  return slotCore.register('main', () => null, { priority })
}
