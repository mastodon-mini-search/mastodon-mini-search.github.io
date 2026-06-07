# 会话 / 存储规格（Sessions Spec）

本文档描述本项目的本地存储与多账号会话契约。它是
`src/functions/sessions.ts`、`src/models/Session.ts` 的行为说明，并由
`tests/functions/sessions.spec.ts` 中的测试强制约束。

## 设计目标

- **按账号分键**：每个账号的嘟文各存各的，互不覆盖。
- **可切换、非破坏**：切换账号只改「当前激活」指针，不删任何缓存，
  切回即用，无需重抓。只有显式「移除账号」才删数据。
- **单一存储入口**：键规则只在 `SessionRepository` 里定义一处，
  组件与其它函数都经它读写，不再各自直接拼 localforage 的键。
- **可测试**：存储介质是可注入的（`KeyValueStore`），生产用 localforage
  （IndexedDB），测试注入内存 Map，会话逻辑无需真实数据库即可单测。

## 数据模型

| 键 | 内容 | 说明 |
|----|------|------|
| `sessions` | `SessionRegistry` | 账号注册表 + 当前激活键 |
| `store:${instanceUrl}:${accountId}` | `StatusStore` | 单账号的嘟文/位置/账号信息（含 OAuth `apiKey`） |
| `index:${instanceUrl}:${accountId}` | `PersistedIndex` | 单账号搜索索引的序列化缓存（派生物，可随时丢弃重建） |
| `oauth-app:${instanceUrl}` | `OAuthApp` | 按实例缓存的 OAuth2 客户端凭证（client_id/secret + redirect_uri/scope），同站复用，免去每次重新注册 |
| `oauth-pending` | `PendingAuth` | 跳转授权前暂存的「进行中登录」（随机 `state` + 实例/redirect/scope）；回跳时校验并消费 |

```ts
interface SessionRegistry {
  accounts: ResolvedAccountSetting[]   // 已知账号
  activeKey: string | null             // 当前激活的 store 键，无则 null
}
```

### 键规则（storeKey）

`accountId` 只在所属实例内唯一，因此键**必须带上 `instanceUrl`**——否则
两个跨实例但 id 相同的账号会互相覆盖。

## 操作语义（由测试约束）

- `addSession(acct)`：免登录路径——解析 handle（不带 token）后转交
  `addResolvedSession`。仅供「不登录、只搜公开嘟文」与会话测试使用。
- `addResolvedSession(account)`：OAuth 流程的入口——传入**已解析**的账号
  （含新鲜的 `apiKey`）→ 若该账号**已有**缓存则原样保留嘟文、只刷新其
  `account`（即换上新 token），否则建空 store → 入注册表（已存在则替换该项，
  不重复）→ 设为激活 → 返回 store。重新登录因此会就地更新 token，不动嘟文。
- `setActive(key)`：只改激活指针。**不动任何数据**——这是「切换」的底座。
- `loadActiveStore()`：读激活账号的 store；无激活账号返回 `undefined`。
- `saveStore(store)`：按 `store.account` 算键写回。
- `loadIndex(account)` / `saveIndex(account, index)`：按账号读写序列化的
  搜索索引缓存（`index:` 键）。这里只当不透明 blob 存取，是否可用
  （版本号 / 文档数 / 反序列化）由索引层 `restoreIndex` 判定。
- `removeSession(key)`：删该账号数据 **+ 索引缓存** + 出注册表；若它正激活，
  则回退到剩余的第一个账号，没有了就置 `null`。

> 索引缓存是**派生物**，生命周期全在 `Main`：启动时优先 `loadJSON` 还原缓存，
> 校验不过（版本/数量不符、解析失败）就从嘟文重建并写回；每次抓取后只把
> **新增**嘟文 `add()` 进现有索引（增量，`indexNewStatuses` 靠 `index.has(uri)`
> 跳过已有的，不全量重建），再重新持久化。`Loader` 只负责抓取，不碰索引。
> 版本号 `INDEX_VERSION` 定义在 `createIndex.ts`——改动分词/索引内容时务必
> 递增,以作废旧缓存。

> 多账号 UI 已接入：`Setup` 走 `addSession`（首个账号）；顶栏的
> `AccountSwitcher` 列出已知账号并支持切换（`setActive` + `loadStore`）、
> 内联新增（`addSession`）、移除当前账号（`removeSession`）。切换器只做数据层
> 变更，再把「新的激活 store（或无账号时的 `undefined`）」经 `changed` 事件
> 交给 `Main`——由 `Main` 统一重建索引、清空上一次搜索，或回到 `Setup`。

## OAuth 登录

私有端点（喜欢 `/api/v1/favourites`、书签 `/api/v1/bookmarks`）必须带 token，
所以要抓喜欢与书签得先走 OAuth。逻辑在 `src/functions/oauth.ts`，纯前端、无后端，
靠 Mastodon 的动态应用注册完成（GitHub Pages 静态托管即可）。

1. **`beginLogin(input)`**：把 `user@instance` / `@user@instance` / `instance.tld`
   / `https://instance` 归一成实例 origin → 注册应用（`POST /api/v1/apps`，
   `scope=read`）或复用 `oauth-app:` 缓存 → 暂存 `oauth-pending`（随机 `state`）→
   跳转到实例的 `/oauth/authorize`。`redirect_uri` 取
   `location.origin + location.pathname`，注册/授权/换 token 三处必须**逐字一致**。
2. **`completeLoginFromRedirect()`**：每次加载都跑。URL 带 `?code=&state=` 时校验
   `state`（拒掉被拒绝/伪造/过期的回跳）→ 用 `code` 换 token（`POST /oauth/token`）
   → `verifyCredentials` 确认 token 并拿到自己的 id/acct → 返回带 `apiKey` 的
   `ResolvedAccountSetting`；否则返回 `null`。无论成败都清掉 `oauth-pending` 并洗掉
   URL 上的查询串，避免刷新重放。

`Main` 启动时先调它：是回跳就 `addResolvedSession` 把新授权账号设为激活，否则照常
`loadActiveStore`。`Setup` 与 `AccountSwitcher` 都同时提供「用 Mastodon 登入」
（`beginLogin`，会跳转离开本页）与「免登入」（`addSession`，只搜公开嘟文）两条路。

> token 存在 `store.account.apiKey`（随 `StatusStore` / 注册表持久化在本机）。
> `fetchStatuses` 用它建带 token 的客户端：自己的嘟文按 `statusMinId` 增量抓。
> 没有 token 时只抓公开嘟文，跳过喜欢/书签。
>
> 喜欢/书签没有可续抓的 status-id 游标——它们按实例内部 record id 分页，而这个 id
> 只在 Link 头里、不在返回的 status 上。所以每类各跑**两段、各自可断点续传**，都按
> Link 头的下一页 `max_id`（`nextMaxId` 从 paginator 私有 `nextParams` 读出）由新到旧
> 翻页，游标存在 `position.favourite` / `position.bookmark`（`MarkedPosition =
> { backfill, catchup }`）：
>
> 1. **backfill（回补到最旧）**：把整串从头翻到底一次。`'top'` 是全新未开始；
>    `{ maxId }` 是上次中断、从那续；`'done'` 是已翻到底。每页推进并落盘，中途失败下次
>    从存的 `maxId` 接续、不重抓；翻到底后置 `'done'`。
> 2. **catchup（追最新，仅在 backfill 为 `'done'` 后跑）**：从顶端往下翻，直到某页整页
>    都是本类型已存过的（追回已覆盖区）或翻到底为止。它也每页落盘自己的 `{ maxId }`，
>    同样可断点续传、不重抓已拿到的页；干净跑完清回 `'idle'`。
>
> 两个游标，是因为两段各有独立的活动前缘——同一段连续覆盖区的顶端与底端。唯一残留
> 缺口：catchup 中断**期间**在最顶新加的嘟文，要等下一趟 catchup 从顶端重起才补上，
> 窗口很窄、会自愈。读不到 `max_id` 时该页不落盘，退回下一次保存。
>
> 迁移：旧版每类只有单个 `${type}MaxId` 游标。`'0'`（已完成或从未跑）视作 backfill 已
> `'done'`（避免老用户重抓全部），真实 id 视作中断的 backfill 续传；首次抓取时由
> `fetchStatuses` 就地折进新的两游标结构。

## 迁移

早期版本把唯一一个 `StatusStore` 存在固定键 `store` 下。`loadRegistry`
首次发现没有 `sessions` 但有遗留 `store` 时，会把它折进新键
（`store:${instanceUrl}:${accountId}`）、建好注册表并设为激活、删掉遗留键。
对老用户透明，已抓取的嘟文不丢。

## 测试

```sh
npm test
```

规格文件：`tests/functions/sessions.spec.ts`（内存 `KeyValueStore` + 桩
`resolve`，覆盖增删、非破坏切换、跨实例不撞键、遗留迁移）。
