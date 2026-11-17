#!/bin/sh
# CI 专用：把构建产物提交回仓库，让 EdgeOne（CNB 类型项目）拉到最新成品。
# 只在产物真的变化时提交 —— 第二次构建发现无变化即停止，不会无限循环。
set -e

cd "$(dirname "$0")/.."

# 需要回写的产物：bundle、前端静态、注入脚本、submodule 指针
git add -A -- \
  'cloud-functions' \
  'index.html' \
  'assets' \
  'inject' \
  'public' \
  'upstream/animaku' \
  'robots.txt' \
  'sitemap.xml' \
  'site.webmanifest' \
  'favicon.ico' \
  'favicon-16x16.png' \
  'favicon-32x32.png' \
  'apple-touch-icon.png' \
  'android-chrome-192x192.png' \
  'android-chrome-512x512.png' \
  'logo.png' \
  'plyr.svg' \
  '4ddfeb9c68384dd99bc302fb0f02eaf1.txt' 2>/dev/null || true

if git diff --cached --quiet; then
  echo "[ci-commit] 产物无变化，跳过提交（循环终止）"
  exit 0
fi

# CI 里的合法提交身份（避免 GPG 403）
git config user.name 'cnb.ageYeGZgDeAAA'
git config user.email 'ZVf1wkjMS765mM87le0jvK+cnb.ageYeGZgDeAAA@noreply.cnb.cool'
git config commit.gpgsign false

# 优先用 CI 注入的 CNB_TOKEN；没有则用 checkout 自带凭据
if [ -n "$CNB_TOKEN" ]; then
  git remote set-url origin "https://oauth2:${CNB_TOKEN}@cnb.cool/kfc50/animaku-edgeone.git"
fi

BRANCH="${CNB_BRANCH:-main}"
git commit -m 'chore: update built artifacts [skip ci]'
git push origin "HEAD:${BRANCH}"
echo "[ci-commit] 已提交并推送产物到 ${BRANCH}"
