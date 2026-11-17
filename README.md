# Animaku EdgeOne — CI 构建/回写机制（问答原话记录）

> 以下内容为 2026-11-17 关于「bundle 谁构建 / 哪里 push / 哪里破局」问答的完整原话，一字不落记录。

---

好问题，这正是这套机制最绕的地方。我先验证一下实际提交内容，再给你讲清楚"哪里 push、哪里破局"，不靠猜。

实测铁证：CI 那次自动提交 `f99c421` 里，`upstream/animaku` 指针从 `1db50dd` → `6b2817cf`（上游最新）。所以 **CI 确实把拉取到的新 submodule 指针 push 回去了**。

现在讲清楚你问的两个问题。

## 1. bundle 是谁构建的？

**两处都会构建，但分工不同：**
- **我本地手动构建了一次**（种子）：让你第一次 push 时仓库里就有现成 bundle，EdgeOne 一上来能部署。
- **之后每次都是 CI 构建**：`build-edge.mjs` 在 CNB 的构建容器里跑。你本地不跑也有。

所以 bundle 不是非得本地构建——本地那次只是"点火"。

## 2. "晚一步" + "哪里 push / 哪里破局"

你的直觉完全对，这就是个**两阶段接力**。我用时序讲：

```
① 你/我 本地 push 一次代码
   （此时 submodule 指针 = 旧的 1db50dd）
   └─ 这只是"点火”，告诉 CI：开工

② 第一次 CI 收到通知，开工：
   ├─ checkout：拿到旧指针 1db50dd
   ├─ git submodule update --remote  ← 关键！去 GitHub 拉 master 最新 → 6b2817cf
   │                                   （这就是你说的"晚一步"才拉到）
   ├─ build-edge.mjs：用新源码重新打包 bundle
   ├─ sync-web.mjs：重新构建前端
   └─ ci-commit-artifacts.sh  ★破局点在这里★
        ├─ git add upstream/animaku（把新指针 6b2817cf 加进去）
        ├─ 发现指针变了 → git commit
        └─ git push origin HEAD:main   ← "哪里 push"：就是这一行
                                          把新指针 + 新 bundle 推回仓库

③ 这个 push 又触发第二次 CI：
   ├─ checkout：拿到新指针 6b2817cf（已经是最新了）
   ├─ submodule update --remote：上游没更新，还是 6b2817cf，不变
   ├─ 重新打包：bundle 内容一样
   └─ ci-commit-artifacts.sh
        └─ git diff --cached --quiet → 无变化 → 不提交、不 push
                                          ↑ "破局"：循环在这里终止
```

**回答你的三个小问：**
- **CI 拉取的 submodule 会 push 吗？** 会。就在 `ci-commit-artifacts.sh` 的 `git add upstream/animaku` + `git commit` + `git push`（脚本第 45 行）。实测 `f99c421` 里指针确实变成 newest。
- **哪里 push 的？** 脚本 `scripts/ci-commit-artifacts.sh` 里的 `git push origin "HEAD:${BRANCH}"`（第 45 行），跑在 CNB 的构建容器里。
- **哪里破局（终止循环）？** 同脚本第 28 行 `git diff --cached --quiet`——第二次构建发现产物没变化，直接 `exit 0`，不 commit 不 push，链条就断了。再加 `[skip ci]` 双保险。

**一句话**：第一次 push 是"点火"，CI 拉新源码→重新打包→**自己把成果 push 回去**（这是破局的 push 点），第二次 CI 发现没变化就停。整个链条自运转，你只点火一次。
