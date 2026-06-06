# Mastodon Mini Search · 站外搜索

為 Mastodon 打造的**純前端**站外搜索工具：把你自己的嘟文、轉嘟、喜歡與書籤抓到本機，建立全文索引後在瀏覽器裡離線搜索。專為中文檢索設計——**免詞典分詞**、**繁簡互通**、**中英混排**。

沒有後端、沒有伺服器。所有資料（嘟文、搜索索引、登入憑證）都只存在你瀏覽器的 IndexedDB 裡，可直接託管於 GitHub Pages 等靜態空間。

## 為什麼

Mastodon 內建搜索對中文不友善（多數實例僅索引標籤，或缺乏中文分詞），也搜不到你的喜歡與書籤。本工具把資料抓到本機自建索引，補上這塊。

## 特色

- **免詞典中文檢索**：不依賴分詞詞典，對中文做子串級檢索（unigram + bigram）。
- **繁簡互通**：用繁體或簡體查詢，都能命中對方書寫的內容（`電腦` ⇄ `电脑`）。
- **中英混排 / 全半形**：`我用iPhone` 正確切分；全形數字（`２０２４`）可被半形查詢命中。
- **搜得更廣**：除正文外，內容警告（CW）與圖片 alt 描述也納入索引。
- **多帳號**：可加入多個帳號並隨時切換，切換非破壞性（不重抓、不刪資料）。
- **登入或免登入**：用 Mastodon OAuth 登入可抓喜歡與書籤；不登入也能搜公開嘟文。
- **隱私**：純前端、無後端，資料不離開你的瀏覽器。
- **命中高亮**：結果中命中詞以 `<mark>` 標出，且跨繁簡 / 全半形對齊。

## 快速開始

需要 Node.js 20+。

```sh
npm install
npm run dev        # 啟動開發伺服器
```

其他指令：

```sh
npm run build      # 型別檢查 + 打包到 dist/
npm run preview    # 預覽打包結果
npm test           # 執行測試（vitest）
npm run test:watch # 監看模式
```

## 使用方式

1. 開啟頁面，在設定畫面輸入你的帳號（`user@instance`、`@user@instance`、`instance.tld` 或完整網址皆可）。
   - **用 Mastodon 登入**：走 OAuth（僅 `read` 權限），可抓自己的嘟文、喜歡與書籤。
   - **免登入瀏覽**：只抓公開嘟文。
2. 進入主畫面後點「載入嘟文 / 喜歡 / 書籤」把資料抓到本機。
3. 在搜索框輸入關鍵字即可即時搜索，並可用類型篩選（嘟文 / 轉嘟 / 喜歡 / 書籤）。

再次造訪會沿用上次的帳號與已抓資料；新嘟文會增量加入既有索引，無需重建。

## 運作原理

- **抓取**：自己的嘟文按 status id 增量續抓；喜歡 / 書籤從最新往下翻，抓到已存過的就停。
- **索引**：用 [MiniSearch](https://github.com/lucaong/minisearch) 建全文索引，並把序列化後的索引快取到本機，下次冷啟動可略過重建。
- **分詞**：同一個 `tokenize` 同時用於建索引與處理查詢，二者按構造保持一致。中文逐字繁→簡正規化後產出 unigram + bigram。
- **儲存**：透過 [localforage](https://github.com/localForage/localForage)（IndexedDB）按帳號分鍵存放。

## 部署

推送到 `master` 會自動透過 GitHub Actions 打包並發布 `dist/` 到 GitHub Pages（見 `.github/workflows/`）。因為是純靜態站，部署到任何靜態空間皆可——OAuth 靠 Mastodon 的動態應用註冊完成，無需後端。

## 技術棧

Vue 3（`<script setup>`）· TypeScript · Vite · [MiniSearch](https://github.com/lucaong/minisearch) · [masto.js](https://github.com/neet/masto.js) · [localforage](https://github.com/localForage/localForage) · Vitest

## 文件

- [`docs/tokenization.md`](docs/tokenization.md) — 分詞 / 檢索 / 高亮規格
- [`docs/sessions.md`](docs/sessions.md) — 本機儲存 / 多帳號會話 / OAuth 規格
- [`CLAUDE.md`](CLAUDE.md) — 整體架構與開發指引

兩份 `docs/` 規格皆由 `tests/` 中的測試強制約束。
