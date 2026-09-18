/**
 * Node 测试环境用的 react-native 替身：仅覆盖模块顶层求值所需成员。
 * 组件本体在 vitest 里从不渲染；StyleSheet.create 必须原样透传，
 * 因为 chat-ui 的 styles 在模块作用域就完成创建。
 */

const identity = <T,>(value: T): T => value

export const StyleSheet = {
  create: identity,
  hairlineWidth: 1,
  flatten: identity,
}

export const Platform = {
  OS: 'node',
  select: <T,>(options: { node?: T; default?: T }): T | undefined =>
    options.node ?? options.default,
}

/** 主题上下文订阅系统外观；Node 档固定返回深色（组件不渲染，仅满足模块求值）。 */
export const useColorScheme = (): 'light' | 'dark' => 'dark'

type FakeComponent = (props: Record<string, unknown>) => null

export const ActivityIndicator: FakeComponent = () => null
export const FlatList: FakeComponent = () => null
export const KeyboardAvoidingView: FakeComponent = () => null
export const ScrollView: FakeComponent = () => null
export const Text: FakeComponent = () => null
export const TextInput: FakeComponent = () => null
export const TouchableOpacity: FakeComponent = () => null
export const View: FakeComponent = () => null
