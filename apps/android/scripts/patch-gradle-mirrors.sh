#!/usr/bin/env bash
# 用法：bash patch-gradle-mirrors.sh <apps/shell 路径>
# 在 expo prebuild 之后执行：把生成的 android 工程切到国内可达镜像。
set -euo pipefail
SHELL_DIR="${1:?usage: $0 <apps/shell dir>}"
AND="$SHELL_DIR/android"
[[ -d "$AND" ]] || { echo "no $AND — run expo prebuild first" >&2; exit 1; }

echo "==> settings.gradle: 前置阿里云镜像仓库"
if ! grep -q "maven.aliyun.com/repository/google" "$AND/settings.gradle"; then
  # dependencyResolutionManagement { repositories {...} } 与 buildscript 两处都要镜像优先
  perl -0pi -e 's/(repositories\s*\{)/$1\n        maven { url '"'"'https:\/\/maven.aliyun.com\/repository\/google'"'"' }\n        maven { url '"'"'https:\/\/maven.aliyun.com\/repository\/public'"'"' }\n        maven { url '"'"'https:\/\/maven.aliyun.com\/repository\/gradle-plugin'"'"' }/g' "$AND/settings.gradle"
fi

echo "==> build.gradle: buildscript repositories 镜像前置"
if [ -f "$AND/build.gradle" ] && ! grep -q "maven.aliyun.com" "$AND/build.gradle"; then
  perl -0pi -e 's/(repositories\s*\{)/$1\n        maven { url '"'"'https:\/\/maven.aliyun.com\/repository\/google'"'"' }\n        maven { url '"'"'https:\/\/maven.aliyun.com\/repository\/public'"'"' }/g' "$AND/build.gradle"
fi

echo "==> gradle-wrapper: 发行包换腾讯镜像"
PROPS="$AND/gradle/wrapper/gradle-wrapper.properties"
if [ -f "$PROPS" ]; then
  VER=$(grep -oE 'gradle-[0-9.]+(-bin|)-all\.zip' "$PROPS" | head -1 | sed -E 's/gradle-([0-9.]+)-.*/\1/')
  if [ -n "${VER:-}" ]; then
    sed -i "s#distributionUrl=.*#distributionUrl=https\\://mirrors.cloud.tencent.com/gradle/gradle-${VER}-bin.zip#" "$PROPS"
    echo "    distributionUrl -> tencent gradle-${VER}-bin.zip"
  fi
fi

echo "完成。"

# hermesc 替身（aarch64 Linux 无官方编译器；shim 原样复制 JS bundle）
APPB="$SHELL_DIR/android/app/build.gradle"
if [ -f "$APPB" ] && ! grep -q 'Android/hermesc-shim' "$APPB"; then
  python3 - "$APPB" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace('react {\n', 'react {\n    hermesCommand = "/home/grant/Android/hermesc-shim/hermesc"\n', 1)
open(p, 'w').write(s)
print('hermesc shim wired')
PY
fi
