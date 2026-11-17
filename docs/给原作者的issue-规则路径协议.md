# 给 Animaku 原作者的 issue（可直接复制提交）

> 目标：请求作者承诺"规则 JSON 的路径与字段格式长期稳定"，让我们基于 Animaku 的发行版
> 能持久地自更新搜索/章节规则。措辞友好、低成本、不索取解密代码。

---

**Title（建议）**: Feature request: keep `default-plugins` rule JSON path & fields stable for downstream forks

**Body（正文）**:

Hi! I'm building a downstream distribution of Animaku (deployed on EdgeOne) that does NOT
fork/modify your source code — I consume Animaku as a git submodule and add features via injection.
Thank you for the great project!

To keep search/chapter sources up-to-date for people who deploy my distribution as a static build
(without a CI), I fetch these rule files at runtime and cache them:

```
https://raw.githubusercontent.com/uerax/Animaku/master/apps/web/src/data/default-plugins/*.json
```

I read fields like `baseURL`, `searchURL`, `searchList`, `chapterResult`, `referer`, `weight`,
`titlePreference`, and feed them to the existing rule engine.

**My request (low cost, no code changes needed from you):**
1. Please keep the `apps/web/src/data/default-plugins/*.json` path stable long-term.
2. Please avoid breaking changes to those rule fields (additive changes are fine).
3. If the path/format ever must change, a short note in a release would help downstream forks adapt.

Optionally, a stable index file (e.g. `default-plugins/manifest.json` listing rule filenames)
would let us avoid hardcoding the 17 filenames — but this is a nice-to-have, not required.

I'm NOT asking for any playback/decryption code — I understand that's your core logic and should
stay internal. I only need the rule JSON contract to remain compatible.

Thanks again! Happy to help if useful.

---

**中文版（如果要发中文 issue）**:

你好！我在做一个 Animaku 的下游发行版（部署在 EdgeOne），不 fork/修改你的源码，而是把 Animaku
作为 git submodule 引入、用注入方式加功能。感谢这么好的项目！

为了让"以静态包部署我这个发行版"的用户也能自动更新搜索/章节源，我在运行时拉取这些规则 JSON
并缓存：

```
https://raw.githubusercontent.com/uerax/Animaku/master/apps/web/src/data/default-plugins/*.json
```

我读取的字段有 `baseURL`、`searchURL`、`searchList`、`chapterResult`、`referer`、`weight`、
`titlePreference` 等，交给现有 rule-engine 解析。

**我的请求（对你零代码改动、成本极低）：**
1. 请长期保持 `apps/web/src/data/default-plugins/*.json` 这个路径不变。
2. 请尽量不对这些规则字段做破坏性变更（新增字段没问题）。
3. 如果将来路径/格式确实要改，在 release 里提一句，方便下游适配。

可选：如果能提供一个稳定的索引文件（如 `default-plugins/manifest.json` 列出所有规则文件名），
我们就不必硬编码 17 个文件名——但这只是锦上添花，不是必需。

我**不索取任何播放/解密代码**——我理解那是你的核心反爬逻辑，应保持内部。我只希望规则 JSON
这个契约保持兼容。谢谢！

---

## 备注

- 这条 issue 对应你提到的"需要向原网站提 issue / PR，让他保持路径或协议"。
- 因为我们是 raw 直链取文件，不依赖 GitHub API，所以只要路径稳定就永久有效——这条 issue 是"加固"，不是"阻塞依赖"。
- 作者若同意，可把他的回复链接贴到 `README.md` 作为"上游已确认稳定"的凭证。
