/**
 * 实验 4：Repack（Rspack 后端）配置骨架。
 * 说明：
 * - 本机（无 Android 工具链）不执行；在开发机上 `npx expo start --dev-client` 配合使用。
 * - 选 Rspack：webpack 在 release 模式有已知构建损坏（callstack/repack#1214）。
 * - 不用 Module Federation：规避 MF×Expo 兼容问题；本方案只用 ScriptManager 单脚本加载。
 */
export default {
  entry: ['./index.ts'],
  output: {
    filename: 'bundles/[name].bundle',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx|js|jsx)$/,
        exclude: /node_modules[/\\](?!react-navigation[/\\]node_modules),
        use: 'babel-loader',
      },
    ],
  },
  plugins: [
    // new RepackPlugin({ context: __dirname }),  // 在开发机上按 Repack 5 文档接入
  ],
  optimization: {
    splitChunks: {
      cacheGroups: {
        react: { name: 'react', test: /[\\/]node_modules[\\/](react|react-native)[\\/]/, chunks: 'all' },
      },
    },
  },
}
