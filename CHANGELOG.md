# Paralir 的安全屋 · 版本沿革志

> 工作留痕・改编版本报告
>
> 本志以编年体记录本站每一次版本改编的缘由、内容、验证与发布去向，务求「凡有改动，必有案可查」。
> 起笔于公元 2026 年 11 月 23 日奠基，迄今已历十次修订。

---

## 凡例

1. **版本命名**：形如 `v20261124e`，前缀 `20261124` 为该轮开发批次的起始日期（批次号），末尾字母 `a / b / c …` 为批次内的第几次改编。故后期在 11 月 27 日提交的 `v20261124d/e` 仍沿用 `20261124` 前缀——此为批次号，非当日日期，特此说明，免生疑义。
2. **版本号落点**：共 7 处——`index.html` 中 6 处静态资源引用（`favicon.png` / `styles.css` / `data.js` / `audio.js` / `gate.js` / `app.js`）的 `?v=` 查询串，以及顶栏可见徽章 `#verBadge`。每次改编均全局同步，避免浏览器缓存导致新旧混用。
3. **三方对齐**：每次发布后，「线上发布站 / 本地代码 / GitHub 仓库」三方的版本号与提交号须完全一致。
4. **留痕范围**：本志只记有据可查的改编；纯测试脚本与约定的调整记于「卷三・制度沿革」。

---

## 卷一・版本总表

| 版本 | 日期 | 提交 | 一句话纪要 | 验证 | 发布 |
|---|---|---|---|---|---|
| 奠基期 | 2026-11-23 ~ 24 | `5e4419c` ~ `7858397` | 站点初成、安全加固、可见版本号上线 | — | 已上线 |
| **v20261124b** | 2026-11-24 | `c528de6` | 升级之路 50 关标注对应讲义章节，可点击跳转 | e2e 通过 | 已上线 |
| **v20261124c** | 2026-11-24 | `02dcecd` | 讲义中心改为站内内嵌，不再跳转新窗口 | 10 项 e2e 通过 | 已上线（补推） |
| **v20261124d** | 2026-11-27 | `28b9e7d` | 公告撤回去掉 confirm，点击即撤 | 回归 24/24 | 已上线 |
| **v20261124e** | 2026-11-27 | `d10d8e4` | 公告撤回改为软删除并记录撤回时间 | 回归 24/24 | 已上线 |
| **v20261124f** | 2026-11-28 | `471f821` | 上线体检后的修复：Boss 血量判定、断网保登录、云请求超时、词库清洗、favicon | jsdom 全流程 0 异常 | 未发布（P0 下线） |
| **v20261128a** | 2026-11-28 | 本次提交 | P0 前端改造：登录/注册/改密/资料/积分/管理员全部改走 RPC，删除客户端哈希 | jsdom RPC 冒烟 0 异常、`node --check` 通过 | 已发布（P0 数据库同步落地） |

> 当前状态：P0 数据库已实施（3 表 + 17 RPC + 权限收紧），本地/GitHub 于本次提交对齐 `v20261128a`，线上已重新发布、sharecode 不变。提交号以 `git log -1` 与 `git ls-remote origin refs/heads/main` 的实时结果为准，不在此写死以免失真。网关此前因下架返回 403，不能作为权限验收依据；三条验收以联调脚本实测为准。

---

## 卷二・编年正文

### 奠基期 · 2026-11-23 至 2026-11-24

** origin `5e4419c`｜Initial commit **
站点初成。确立深绿色高冷轻恐怖的整体风格，以及 Pary、小 Rarys、Papa 的世界观叙事。四大板块——术语检索、升级之路故事闯关、我是单词、聊天社交——同批落地，管理员系统、音乐工具栏与讲义中心雏形俱备。宗卷：`index.html`、`app.js`、`data.js`、`audio.js`、`gate.js`、`styles.css`。

** `38beff0`｜docs: add README **
补撰 README，并设公开演示账号 `User1 / USER11`，风格独立于站点所有者及任何私人账号，供仓库演示登录、闯关与社交。

** `620b423`｜fix: 加固解析与竞态 **
以 `safeParseJSON()` 取代裸 `JSON.parse`，防污染 localStorage 致全站瘫痪；`init()` 增 try/catch/finally，确保 `#boot` 必定收起；立 `battleEpoch`，创建的延迟推进回调须校验世代，防退出登录后串场；立 `adminRenderSeq`，异步渲染后校验页面状态；立 `withPointsLock()`，积分增减串行化，管理员调分锁内重读最新值。

** `69b0fe9`｜chore: 删死代码、修门禁跳过 **
删 `shortZh()`、`leadingPos()` 两处死代码；修 `#gateSkip` 空操作为 `skip.onclick = finish`，跳过开场得以真正生效。

** `8085e54`｜fix: 修复头像破图 **
`gate.js` 中 `#gateLogo` 空 src 请求致破图；`setLogo()` 统一初始化 `#brandLogo` / `#bootLogo` / `#gateLogo` / `#favicon` 四处为同一头像。

** `7858397`｜feat: 可见版本号徽章 **
顶栏加可见徽章 `#verBadge`，与资源版本号全局同步——自此「版本号」由隐式变为明牌，为后续所有改编立下可对照的标尺。此即 `v20261124a` 之始。

---

### v20261124b · 升级之路标注讲义章节 · 2026-11-24 · `c528de6`

**缘由**：用户命「每个升级之路的各个关卡都要写下对应讲义的章节」。经问询，定呈现方式为「关卡地图与学习页皆显示章节，有讲义权限者可点击直达，无权限者仅见文字」。

**改编详情**：
- `data.js`：`window.STORY` 全部 50 关（5 方向 × 10 关）注入 `lecture` 字段，每项含 `{dir, a(锚点), t(章节标题)}`，按讲义真实章节逐一映射。逆向第 3 关因同涉 IDA 与 Ghidra，连标两章。全部锚点经脚本校验，确认在对应讲义 HTML 中真实存在。
- `app.js`：新增 `storyLectureUrl(dir,anchor)`（拼接 `lectures/<dir>/index.html` + 透传 `location.search` + `#锚点`）、`openStoryLecture()`（白名单 `canUseLectures()` 校验，无权限则 toast 提示）、`lectureChipsHTML()`、`bindLectureChips()`；地图 `level-node` 与学习页 `si-lecture` 均渲染章节 chip，点击 `stopPropagation` 以免误入关卡。
- `styles.css`：新增 `.ln-lecture` / `.lec-chip` / `.si-lecture` 样式。
- 版本号 `20261124a → 20261124b`（6 处全局）。

**验证**：`e2e_story_lecture.js` 覆盖 5 方向的地图页、学习页与跳转 URL，全部通过，无 JS 报错。**发布**：已上线；提交 `c528de6`，依安全边界自动推送（`7858397..c528de6`），推送后本地／远程 `0 0`。

---

### v20261124c · 讲义中心内嵌化 · 2026-11-24 · `02dcecd`

**缘由**：用户命「讲义中心改为内嵌式，点击不要跳转到别的地方，就在原来的网站上面」。

**改编详情**：
- `app.js`：新增 `renderLecturesEmbed()`（在 `#main` 内渲染 iframe + 返回条，透传 sharecode）、`activatePageTab()`、`lectureEmbedSrc()`；`openOwnerLectures()` 改为 `go("owner-lectures")`；`go()` 路由对 `owner-lectures` 直接内嵌渲染；`openStoryLecture()` 改为内嵌并在框内定位锚点，返回逻辑改以当前 DOM（`.battle-wrap` / `.story-intro`）判定是否身处战斗页，避免地图页误判；看讲义期间 `stopLevelTimer()`，返回时按阶段恢复计时，看讲义不白耗挑战时间。
- `styles.css`：新增 `.lec-embed` / `.lec-embed-bar` / `.lec-embed-title` / `.lec-embed-hint` / `.lec-frame` 及移动端适配。
- 版本号 `20261124b → 20261124c`（6 处）。

**验证**：`e2e_lectures_embed.js` 十项全过——顶栏内嵌、sharecode、tab 高亮、iframe 加载、返回主页、章节定位、返回地图、学习页往返、无新窗口（`newTabs=0`）、无 JS 错误。

**发布・波折**：已上线。首次推送遇网络代理故障（`502 CONNECT tunnel failed` / `Empty reply from server` / `schannel` 中断）；依「推送安全边界」不强推、不反复重试，先只读 `git ls-remote` 探得连通后补推成功（`c528de6..02dcecd`），推送后 `0 0`、工作区干净。此为「对不上先报告、网络恢复再补推」规则的一次实战。

---

### v20261124d · 公告撤回去掉确认框 · 2026-11-27 · `28b9e7d`

**缘由**：用户命「撤回按钮的 confirm 框能不能去掉，省得留脏数据」——旧脚本因未接住 confirm 而致测试公告残留。

**改编详情**：
- `app.js:1023`：删去公告撤回的 `confirm("确认撤回这条公告？…")`，点击直接执行删除。聊天消息撤回的 confirm（`app.js:845`）保留——其用途为防误删，非脏数据来源。
- `e2e_announcement.js`（dev）：删去不再需要的 dialog 自动接管。
- 版本号 `20261124c → 20261124d`（6 处）。

**验证**：本地回归 24/24 全过。**发布**：上线 → 提交 `28b9e7d` 自动推送（`02dcecd..28b9e7d`）→ 提交后回归 24/24 → 只读对账全绿（工作区干净、`rev-list 0 0`、`ls-remote` 线上真实 main = 本地 HEAD = `28b9e7d`、仅 main 一分支）。

---

### v20261124e · 公告撤回软删除并留痕 · 2026-11-27 · `d10d8e4`

**缘由**：用户命「撤回按钮加个撤回时间，别直接删」——撤回须留痕，不物理删除。

**关键发现**：云表 `announcements` 原无 `recalled_at` / `recalled_by` 列，直接 `update` 报 `Could not find the 'recalled_at' column`。依云数据库管理规范，以安全可逆的 migrate 模式执行两条 `ALTER TABLE … ADD COLUMN IF NOT EXISTS`（`recalled_at TIMESTAMPTZ`、`recalled_by TEXT`）补列成功。

**改编详情**：
- `app.js`：撤回改 `.update({active:false, recalled_at:ISO, recalled_by:username}).eq("id", id)`——沿用本有的 `active === false` 软删除语义，辅以新列记录时间与操作人。管理列表中已撤回项显示「🕒 撤回时间 … · 操作人 …」，撤回按钮易为「已撤回」且不可重复点击。
- 顺手清理云数据库此前测试遗留的 3 条生效中公告（id 8/9/10），按新逻辑软删除留痕而非硬删。
- `e2e_announcement.js`（dev）：断言由「列表消失」改为「记录仍在 + 状态已撤回 + 有撤回时间 + 公告栏不再显示」；`#btnAnnounce` 等待 20s → 45s（CDN 偶发慢）。`e2e_search_order.js`（dev）：goto 超时 30s → 60s。
- 版本号 `20261124d → 20261124e`（6 处）。

**验证**：e2e 实测撤回后记录仍在、状态已撤回、显示撤回时间、公告栏隐藏，全过；本地回归 24/24。**发布**：上线 → 提交 `d10d8e4` 自动推送（`28b9e7d..d10d8e4`）→ 提交后回归 24/24 → 对账全绿（`0 0`、`ls-remote` = 本地 HEAD = `d10d8e4`、仅 main、版本号 6 处一致）。

---

### v20261124e · 版本一致性整饬与工作留痕立卷 · 2026-11-27

**缘由**：用户命「每个地方的版本都要一致，如果有那些地方需要比较也要有改编版本的报告和具体详情，类似于写历史那种感觉，就工作留痕」。

**改编详情**：
- 统一散落旧版本号：dev 目录 `e2e_intel_notice.js`（原 `20261123w`）、`e2e_study_consistency.js`（原 `20261123v`）一并升至 `20261124e`；`run_tests.js` 排除注释中的旧版本号表述同步改写。至此全仓版本号整齐划一。
- 立本志 `CHANGELOG.md`：以编年体补录自奠基至 `v20261124e` 的每次改编，附版本总表、制度沿革、一致性核验，供后来者考据。
- `README.md` 增「当前版本」标识与版本沿革志入口。

**说明**：本卷为文档与测试脚本层面的整饬，未触及站点运行代码，故版本号仍为 `v20261124e`，不另升号——保持「每个地方版本一致」。

---

### v20261124f · 上线体检后的修复批次 · 2026-11-28

**缘由**：对线上站点做了一次完整体检（资源探测、源码比对、jsdom 全流程、云端接口最小化只读验证），依体检报告修复其中可由前端代码解决的部分。

**改编详情**：
- `app.js`：
  - Boss 血量只在答对时扣减（`storyNext` / `wordNext` 增加 `correct` 参数）；Boss 题用尽仍未击杀则循环出题，避免 `bossIdx` 越界读到 `undefined`。
  - `loadUser()` 网络异常时不再清除登录态，仅账号确实不存在/被禁时才清除。
  - 新增 `withTimeout()`，`init()` 内云端请求 8 秒超时降级，避免一直停在「正在连接云端服务…」。
  - `setUser()` 只把 `{id, username}` 写入 localStorage，不再落 `pass_hash` / 邮箱 / 手机号。
  - 登录错误统一为「账号或密码错误」，且先验密码再报审核状态，避免探测账号是否存在。
  - 头像 `src` 补 `esc()`；管理员列表改为显式列出所需字段，不再 `select("*")` 拉取 `pass_hash`。
  - 学习页音效开关改为只更新按钮文案，不再整页重绘导致阅读位置回顶。
  - 错题阶段进度显示修正差一（首题由 `0 / N` 改为 `1 / N`）。
- `data.js`：删除四级词库中 23 个单字母脏词条（`b`–`y` 中除 `i`）；修正 4 条抓取残留释义（`duck` / `spite` / `heel` / `generation`）；补齐 `circulatory` 等 5 个词的英式/美式音标。
- `index.html` / `favicon.png`：favicon 由 JPEG data URI 改为 64×64 PNG 静态文件；版本号 6 处同步至 `20261124f`。
- `README.md`：当前版本更新为 `v20261124f`。

**未处理（需服务端/平台侧解决）**：云数据库对持有 publishable key 的匿名请求开放读写，`app_users.pass_hash` 可被匿名读取。前端无法修复，须在 WorkBuddy 后台配置行级权限或迁移到服务端接口。详见体检报告。

**验证**：`node --check` 全通过；jsdom 冒烟（首页/术语/故事/单词/资料/管理 6 页）+ 故事 22 题连续作答 + 单词 3 题，JS 异常 0；数据校验脏词条 0、脏释义 0。

---

### v20261128a · P0 安全修复前端改造（对接 RPC 契约 v3） · 2026-11-28

**缘由**：P0 验收要求匿名读不到 `pass_hash`/`email`/`phone`/`birthday`、匿名写不进 `app_users`/`app_settings`；前端原先直读密码哈希、直写用户表，必须与数据库收紧同批改造。

**契约依据**：`P0-RPC契约定稿.md` v3（17 个 RPC、`ps_sessions` 会话令牌、bcrypt + 旧哈希迁移）。

**改编详情**（`app.js`）：
- 删除客户端 `sha256()` / `passHash()` 与常量盐；新增 `ps_token` 存取、`ERR_ZH` 错误码表、`rpc()` 封装（含 `token_expired` 自动清登录态）。
- `loadUser()` 改为 `ps_me(p_token)`：失效清 token，网络错误保留登录态；`setUser()` 仅在 `u.token` 存在时写 `ps_token`。
- `login()` → `ps_login` + `ps_me`；`register()` → `ps_register`（删除前端查重与插入）；`showChangePwd()` → `ps_change_password`（成功后强制重登）。
- `awardPoints(delta, levelKey)` → `ps_award_points`，关卡键 `story:<方向>:<关>` / `word:<方向>:<关>`；处理 `already_awarded` / `daily_cap`。
- 资料保存 → `ps_update_profile`（不再传生日时间戳）；头像 → `ps_set_avatar`。
- 管理面板：列表 → `ps_admin_list_users`；审核 → `ps_admin_set_status`；角色/禁言/生日/调分/组队上限/重置密码 → 对应 `ps_admin_*`。
- 讲义名单保存 → `ps_set_lecture_access`；退出登录补 `ps_logout`。

**验证**：`node --check` 通过；jsdom 模拟 RPC 测试：登录 → 首页 → 管理列表 → 资料保存 → 退出（调用序列 `ps_login/ps_me/ps_admin_list_users/ps_update_profile/ps_admin_list_users/ps_logout`，0 异常）；仅带 `ps_token` 启动可自动登录（`ps_me`）。

**未完成**：数据库 17 个 RPC、3 张表、REVOKE/GRANT 由 WorkBuddy 在用户签字后执行；联调通过前站点保持下线。

---

## 卷三・制度沿革

> 工作留痕不止于代码，亦含规矩之立废。以下约定已载入项目长期记忆，与本志并观。

| 立制日期 | 约定 | 要旨 |
|---|---|---|
| 2026-11-24 | 改动即上线 | 对站点代码／数据／讲义的任何改动，完成后直接同步线上，无需逐次询问。 |
| 2026-11-24 | 推送安全边界 | 仅当「本地干净领先远程」方自动 push；遇分叉或落后，一律不推、先报告，由用户定夺拉取或 rebase；推送失败如实告知，不反复重试。 |
| 2026-11-24 | 绝对禁止强推 | 任何情况下禁用 `git push --force` / `-f` 或任何强推覆盖远程，亦不得用以解决分叉或失败。与上条并列生效、互不覆盖。 |
| 2026-11-26 | 提交后自动跑测试 | 每次提交并推送后，自动运行一键回归 `run_tests.js`，再做只读对账；测试失败如实报告，不忽略、不重试掩盖。 |
| 长期 | 版本号全局同步 | 版本号以 `sed` 全局替换，页面徽章与 5 处资源引用一并更新，始终保持一致。 |

**一键回归 `run_tests.js`**（dev 目录）：自动起／复用本地 8765 静态服务器，顺序跑 12 项纯逻辑测试 + 12 项浏览器 e2e；全通过退出码 0，任一失败退出码 1。含稳定性处理——e2e 间隔 800ms、偶发失败自动重试一次（连续两次失败仍判真失败，不掩盖问题）。

---

## 卷四・版本一致性核验

> 立卷之时（2026-11-27）逐处核对，录此以备后来比对。表中提交号为**立卷当时的快照**，仅供考据；实时值请以 `git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main` 为准。

| 核对处 | 立卷时实测版本 | 结论 |
|---|---|---|
| 发布目录 `index.html`（5 资源引用 + 1 徽章） | `20261124e` × 6 | 一致 |
| 线上发布站实际返回 | `20261124e` × 6 | 一致 |
| dev 测试脚本 | `20261124e` × 2 | 一致 |
| GitHub 仓库最新提交（立卷快照） | `d10d8e4`（v20261124e） | 一致 |
| 本地 HEAD / `origin/main`（立卷快照） | 同为 `d10d8e4`，`rev-list 0 0` | 一致 |
| 分支 | 本地与远程均仅 `main` | 无多余 ahead/behind |

---

## 卷五・涉事文件索引

| 文件 | 职责 |
|---|---|
| `index.html` | 入口；版本号 6 处落点之一（徽章 + 5 资源引用） |
| `app.js` | 核心逻辑；历次改编主战场 |
| `data.js` | 词库／术语／音标／`STORY` 关卡数据 |
| `audio.js` / `audio/` | 音乐与音效 |
| `gate.js` | 世界观门禁（注册后可见） |
| `styles.css` | 样式 |
| `lectures/` | CTF 讲义中心网页（白名单可见） |
| `CHANGELOG.md` | 本志・版本沿革留痕 |
| `README.md` | 项目说明与演示账号 |

---

*本志随版本演进而续写。凡有新改编，当于卷二添纪、卷一改表、卷四重核，勿使留痕中断。*
