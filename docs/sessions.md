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
| `store:${instanceUrl}:${accountId}` | `StatusStore` | 单账号的嘟文/位置/账号信息 |
| `index:${instanceUrl}:${accountId}` | `PersistedIndex` | 单账号搜索索引的序列化缓存（派生物，可随时丢弃重建） |

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

- `addSession(acct)`：解析账号 → 若该账号**已有**缓存则原样保留（不清空），
  否则建空 store → 入注册表（不重复）→ 设为激活 → 返回 store。
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
