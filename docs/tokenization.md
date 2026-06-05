# 分词 / 检索规格（Tokenization Spec）

本文档描述本项目搜索的文本处理契约。它是 `src/functions/tokenize.ts`、
`src/functions/stripHTML.ts`、`src/functions/normalizeChinese.ts`、
`src/functions/isCJKWord.ts` 的行为说明，并由
`src/functions/*.spec.ts` 中的测试强制约束。

## 设计目标

- **无词典的中文检索**：不依赖分词词典即可对中文内容做子串级检索。
- **繁简互通**：用繁体或简体查询，都能命中对方书写的内容。
- **中英混排**：`我用iPhone` 这类混合文本能正确切分。
- **索引 / 查询一致**：同一个 `tokenize` 同时用于建索引和处理查询，
  二者按构造保持一致，不会各自漂移。

## 管线

输入文本（建索引时是 `stripHTML` 后的纯文本，查询时是用户输入）依次经过：

| 步 | 处理 | 说明 |
|----|------|------|
| 1 | `String.normalize('NFKC')` | 全角字母/数字折半角（`２０２４`→`2024`、`ＡＰＰ`→`APP`），并归一化兼容字符 |
| 2 | CJK ↔ 非 CJK 边界插空格 | `我用iPhone` → `我用 iPhone` |
| 3 | 按空白与标点（`\p{Z}`/`\p{P}`）切段，**丢弃空段** | 标点连击不再产生空 token |
| 4a | **全 CJK 段**：逐字繁→简，再产出 **unigram + bigram** | `计算机` → `计 算 机 计算 算机` |
| 4b | **其它段**：整段作为一个 token | `iPhone` → `iPhone` |

> 大小写折叠**不在** `tokenize` 内完成，而是交给 MiniSearch 默认的
> `processTerm`（小写化），它对本函数产出的每个 token 都会运行。因此
> `tokenize('ＡＰＰ')` 返回 `['APP']`，落到索引/查询里都会进一步变成 `app`。

### CJK 判定

`isCJKWord` 的 CJK 区间（含中文、日文假名等，详见 `isCJKWord.ts`）是唯一来源，
`tokenize` 通过 `import { CJK }` 复用，避免两处重复维护。

### 繁→简归一化

`normalizeChinese` 是一张约 2800 条的**单字** T2S（Traditional→Simplified）映射，
覆盖异体字（如 `裡`/`裏` 同归 `里`）。它把繁体**折叠进简体**，于是繁/简两侧
都落在同一规范形上，实现互查。

## HTML 提取（stripHTML）

Mastodon 正文是 HTML（`<p>` 分段、`<br>`、`<a>` 提及/标签等）。`stripHTML`：

- 在每个**块级元素**前插入分隔空格，避免 `textContent` 把
  `<p>foo</p><p>bar</p>` 粘成 `foobar` 这种不可检索的 token。
- 行内标记（如 `<strong>`）**不**插分隔，使一个词内部的标记保持相连
  （`foo<strong>bar</strong>` → `foobar`）。
- 折叠多余空白。属性值（如 `href`）不进入文本。

## 行为保证（由测试约束）

- `计算机` → `['计','算','机','计算','算机']`
- 单字只产 unigram：`好` → `['好']`
- 繁简等价：`tokenize('電腦')` === `tokenize('电脑')`
- 不跨标点产生 bigram：`你好，世界` 不会出现 `好世`
- 全角数字可被半角查询命中（端到端）
- 段落边界不粘连：`foo`、`bar` 各自可检索，`foobar` 不命中

## 检索语义

- `combineWith: 'AND'`：多 token 查询要求**全部命中**。
- CJK token 关闭模糊匹配；非 CJK 开启 `fuzzy: 0.35`（`maxFuzzy: 4`）。

## 已知限制 / 后续可做

- **CJK 精度上限**：bigram 链式匹配不等于精确短语；MiniSearch 无位置索引，
  少数情况下非严格相邻的字也可能命中。要精确短语需自行加位置校验，暂不做。
- **英文无词干**：`running` 与 `run` 是不同 token，仅靠 fuzzy 兜底。
  如需提升英文召回，可给 `processTerm` 挂 Porter stemmer。
- **韩文**：谚文音节不在 CJK 区间，按非 CJK 整词处理（无 bigram）。
- **拼音搜索**：尚未支持。可为每个 CJK 字额外索引拼音 token 实现
  `jisuanji` → `计算机`，属独立特性。
- **搜索结果高亮**：尚未实现；若实现，高亮器必须复用同一套 normalize/分词逻辑
  （繁简、bigram、NFKC），否则与命中结果对不齐。

## 运行测试

```sh
npm test         # 单次运行（vitest run）
npm run test:watch
```

测试在 `happy-dom` 环境下运行，以便 `stripHTML` / `createIndex` 使用的 DOM API
（`document.createElement` 等）可在 Node 下工作。规格文件：

- `src/functions/tokenize.spec.ts`
- `src/functions/stripHTML.spec.ts`
- `src/functions/createIndex.spec.ts`（端到端检索）
