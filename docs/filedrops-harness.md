# filedrops — Build Harness for Coding Agents

> 這份文件是**規格**,不是教學。它只描述「要做出什麼」「用什麼關鍵技術」「怎麼算做完」。
> 實作程式碼請你自己寫。技術識別字(端點、env、函式名)請照抄,不要自創。

---

## 0. 目標

自架的**臨時檔案中轉站**:走到任何一臺電腦,打開瀏覽器,輸入一組通關碼,就能在不同電腦之間雙向傳檔。不用註冊、不用登入任何帳號。服務常駐在自己的機器上,透過 Cloudflare Tunnel 掛在自己的網域底下(例:`drop.example.com`)。

**典型情境:** 到客戶現場 → 用現場的電腦開網址 → 輸入通關碼 → 拖檔上傳 → 自己的工作筆電在同一個房間看到 → 下載。反向亦然。偶爾把通關碼給別人,請對方傳檔給你。

---

## 1. 硬性限制(Non-negotiable)

| 項目 | 限制 |
|---|---|
| 資料庫 | **無**。檔案系統是唯一持久層。不得引入任何 DB、Redis、KV。 |
| 帳號系統 | **無**。沒有註冊、沒有 OAuth、沒有多使用者。只有**一組全站通關碼**。 |
| Runtime | Node.js 20+,CommonJS(`"type": "commonjs"`)。 |
| Runtime 相依套件 | 只允許:`express`、`multer`、`qrcode`、`cookie-parser`。**不得新增其他 runtime 相依。** |
| 測試相依 | 只允許 `supertest`(devDependency)。 |
| 測試框架 | Node 內建 `node:test` + `node:assert`,以 `node --test` 執行。**不得使用 Jest / Vitest / Mocha。** |
| 即時性 | **輪詢**,不得使用 WebSocket / SSE。 |

---

## 2. 關鍵技術(照這些做,別自創路線)

### 2.1 認證:HMAC 簽章 cookie(無狀態)
- 不使用 session store。cookie 值格式**必須**為 `<payloadB64url>.<sigB64url>`。
- `payload` 為 JSON `{"iat": <epoch-ms>}`,`sig` 為 `HMAC-SHA256(payloadB64url, COOKIE_SECRET)`。
- 驗證時檢查:格式(必須恰為 2 段)、簽章相符、payload 為物件且非 `null`、`iat` 為數字、未逾期。**任一不符一律回傳 false,絕不可 throw。**
- 通關碼比對與簽章比對**必須**使用 constant-time 比較(`crypto.timingSafeEqual`),並在長度不同時直接回傳 false(`timingSafeEqual` 長度不同會 throw)。

### 2.2 儲存:檔案系統即資料庫
- 房間 = `DATA_DIR/<room-code>/` 資料夾。資料夾存在即代表房間存在。
- 每個房間一份 `.meta.json`,對照 `id → { id, name, size, mime, uploadedAt }`。
- **實體檔名 = 伺服器產生的隨機 id**(建議 16 bytes hex)。使用者的原始檔名**只**存在 meta 裡,以及下載時的 `Content-Disposition`。

### 2.3 路徑穿越防禦(最重要,兩道獨立防線)
1. **房間碼**:嚴格 regex 驗證 → `path.resolve` 後**必須**再驗證結果仍位於 `DATA_DIR` 之內,否則 throw。
2. **檔案 id**:採 **meta-existence gate** — `getFile`/`deleteFile` **必須先確認 id 是 `.meta.json` 的既有 key,才可以組路徑**。因為 meta 的 key 只可能是伺服器自己產生的亂數,攻擊者送入的 `../../x` 查不到 key,直接 404。
- **鐵則:任何情況下都不得用使用者提供的字串(尤其是原始檔名)去組檔案路徑。**

### 2.4 Capability URL
- 房間碼是不可猜的亂數 = 分享機制本身。安全性來自熵,不是 ACL。
- 字母表**必須**排除易混字元。使用 `abcdefghjkmnpqrstvwxyz23456789`(無 `0 o 1 i l`),長度 6。
- 亦需支援使用者自訂的固定房間碼(當常用空間)。

### 2.5 串流上傳
- 使用 `multer.diskStorage`,檔案邊收邊寫入磁碟,**不得**整包讀進記憶體。
- 單檔大小上限透過 multer `limits.fileSize` 在串流過程中即時中止。

### 2.6 Express 4 async 陷阱(必做,否則服務會死)
- Express 4 **不會**接住 async route handler 的 rejection;未接住的 rejection 會讓整個 process 終止。
- **必須**用一個 wrapper(`fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next)`)包住**每一個** async handler,並註冊一個 error middleware(需放在所有路由**之後**)。
- error middleware 需:multer 的 `err.code === 'LIMIT_FILE_SIZE'` → `413`;其餘 → `500` 且**不得把 stack 吐給 client**。

### 2.7 反向代理與 cookie
- 服務跑在 Cloudflare Tunnel 後方,收到的是 loopback 的 plain HTTP + `X-Forwarded-Proto`。
- **必須**設 `app.set('trust proxy', 'loopback')`。**不可**設 `true`(會連偽造的 `X-Forwarded-For` 都信,使 IP rate limit 失效)。
- cookie 必須 `HttpOnly`、`SameSite=Lax`、`Secure`。`Secure` **預設開啟**,只在明確設定 `SECURE_COOKIE=false` 時關閉(供本機 http 測試用)。
  - 注意:supertest/superagent 會遵守 `Secure` 而不在 http 下回送 cookie,所以測試組態必須關掉它。

### 2.8 非 ASCII 檔名(⚠️ 這裡有一個一定會踩的坑)

**坑:multer 1.x(busboy)預設用 latin1 解碼 multipart 的 `filename`。**
所以瀏覽器上傳 `客戶報告.txt` 時,`file.originalname` 拿到的是「該檔名的 UTF-8 位元組,每個位元組當成一個 latin1 字元」= mojibake。實測:

| | codepoints |
|---|---|
| 應該是 `客戶報告` | `5ba2 6236 5831 544a` |
| `file.originalname` 實際是 | `e5 ae a2 e6 88 b6 e5 a0 b1 e5 91 8a` ← 這是 UTF-8 位元組 |

**後果是雙重的**:清單顯示亂碼,而且 `filename*=UTF-8''...` 會把「已經壞掉的字串」再 percent-encode 一次(雙重編碼),下載檔名也是壞的。**檔案內容本身不受影響** — 只有檔名壞,所以很容易矇混過關沒被發現。

**修法** — 在寫入 metadata 前把 `originalname` 重新解讀成 UTF-8,並用 round-trip 檢查確保只在位元組確實是合法 UTF-8 時才轉換(對純 ASCII 是 no-op,對非 UTF-8 位元組不破壞):

```js
function decodeOriginalName(name) {
  const buf = Buffer.from(name, 'latin1');
  const utf8 = buf.toString('utf8');
  return Buffer.from(utf8, 'utf8').equals(buf) ? utf8 : name;
}
```
> (multer 2.x / 新版 busboy 可改用 `defParamCharset: 'utf8'`。若你選擇升級,仍須以 E7 測試佐證。)

**`Content-Disposition` 本身**必須同時提供 ASCII fallback 與 RFC 5987 擴充:
`attachment; filename="<ascii-sanitized>"; filename*=UTF-8''<percent-encoded>`
ASCII fallback 需濾掉控制字元與 `"` `\`,避免 header injection。

> 💀 **真實教訓**:本專案初版 43 支測試全綠、9 輪 code review 全過,卻沒抓到這個 bug — 因為所有測試都只用 ASCII 檔名(`greeting.txt`),而**沒有人真的跑過 app**。規格裡寫了「中文檔名要正確」,但從來沒變成一支測試。E7 不是選配。

### 2.9 併發寫入
- `.meta.json` 是 read-modify-write。**同一房間**的併發上傳會互相覆蓋而**靜默遺失檔案**。
- **必須**對同一房間的 meta 寫入做序列化(以房間解析後的絕對路徑為 key 的 in-process promise chain),或改用每檔一份 sidecar。
- 序列化用的 tail promise **必須**是不會 reject 的,否則一次失敗會永久卡死該房間的鏈。

### 2.10 Rate limit
- 不得引入外部套件。手寫 in-memory sliding window(`Map<ip, timestamp[]>`)即可。
- 套用於通關碼輸入與上傳。超過 → `429`。

---

## 3. 功能規格

### 3.1 全站門禁(Gate)
- 除 `/robots.txt`、`GET/POST /gate`、`POST /logout` 外,**所有**路由(含靜態資源)都必須在門禁之後。
- 無有效 cookie → 轉址 `/gate`;頁面上只有一個通關碼輸入框,**不得**洩漏任何其他功能。
- 通關碼正確 → 種 cookie(預設 90 天)→ 轉址 `/`。
- 通關碼錯誤 → **HTTP 401**,且**不得**種任何 cookie,且畫面上要**看得到錯誤訊息**。
  - 注意:Express 的 `res.redirect()` 會把狀態碼蓋成 302,所以「401 + 轉址」是做不到的。錯誤時請直接回傳 401 + 帶錯誤訊息的頁面。
- `POST /logout` 清除 cookie → 轉址 `/gate`(給公用電腦離開前使用)。
- 所有回應都要帶 `X-Robots-Tag: noindex`;`/robots.txt` 需 `Disallow: /`。

### 3.2 房間(Room)
- `GET /` 首頁:一顆「建立新房間」按鈕,另可直接輸入既有/自訂房間碼前往。
- `POST /new`:產生亂數碼 → `302` 到 `/r/<code>`。
- `GET /r/:code`:房間頁。碼格式不合法 → `404`。
- 房間頁需含:房間網址 + **QR code**、拖拉上傳區、檔案清單(檔名/大小/下載/刪除)、清空房間、登出。
- 前端每 **4 秒**輪詢清單,自動更新(對方上傳後這邊免手動重整即可看到)。

### 3.3 檔案
- `GET /r/:code/list` → JSON `{ files: [...] }`,依上傳時間**新到舊**排序;房間不存在時回 `[]`(不可 throw)。
- `POST /r/:code/upload` → multipart,欄位名 `files`,支援多檔。
- `GET /r/:code/file/:id` → 串流下載;id 不存在 → `404`。
- `POST /r/:code/delete/:id`、`POST /r/:code/clear`。
- `GET /r/:code/qr` → JSON `{ dataUrl }`,PNG data URI,內容為該房間的絕對網址(由 `x-forwarded-proto` 或 `req.protocol` + `Host` 組成)。

### 3.4 生命週期
- 檔案以**手動清除**為主(刪單檔 / 清空房間)。不做「下載後即刪」、不做檔案定時刪除。
- 保險機制:**空**房間閒置超過 `ROOM_IDLE_DAYS`(預設 7)自動移除資料夾。**有檔案的房間永遠不可自動刪除。**
- 清理工作以 interval 排程(建議每小時),必須 `.unref()` 且對 promise 掛 `.catch()`。

---

## 4. 環境變數

| Var | Default | 說明 |
|---|---|---|
| `PORT` | 3000 | 本機監聽埠 |
| `ACCESS_PASSPHRASE` | (必填) | 全站通關碼,缺少時啟動即 throw |
| `COOKIE_SECRET` | (必填) | cookie HMAC 金鑰,缺少時啟動即 throw |
| `DATA_DIR` | `./data` | 房間資料夾根目錄,需 resolve 成絕對路徑 |
| `MAX_FILE_MB` | 2048 | 單檔上限 |
| `ROOM_IDLE_DAYS` | 7 | 空房閒置移除天數 |
| `COOKIE_MAX_AGE_DAYS` | 90 | cookie 效期 |
| `SECURE_COOKIE` | true | 僅本機 http 測試時設 false |

---

## 5. 驗收規則(Acceptance Criteria)

**全部必須有自動化測試佐證,並且 `node --test` 全綠。**

### A. 門禁
- [ ] A1 未帶 cookie 存取 `/` → `302` 到 `/gate`。
- [ ] A2 錯誤通關碼 → `401`,且回應**不含** `Set-Cookie`。
- [ ] A3 錯誤通關碼的回應內容**看得到**錯誤訊息(不是空白頁)。
- [ ] A4 正確通關碼 → 種 cookie → `302` 到 `/`;帶著該 cookie 存取 `/` → `200`。
- [ ] A5 `POST /logout` 後再存取 `/` → 又被轉回 `/gate`。
- [ ] A6 任一回應都帶 `X-Robots-Tag: noindex`;`/robots.txt` 含 `Disallow: /`。
- [ ] A7 連續錯誤嘗試超過上限 → `429`(此測試需用**自己新建的 app 實例**,以免污染其他測試的限流計數)。

### B. 認證原語
- [ ] B1 正確通關碼比對回 true;長度不同 / 不符回 false(**不可 throw**)。
- [ ] B2 簽章 token 以相同 secret 驗證 → true;不同 secret → false。
- [ ] B3 逾期 token → false。
- [ ] B4 格式錯誤 token(非字串 / 1 段 / 3 段)→ false。
- [ ] B5 **payload 為 JSON `null` 且簽章正確**的 token → 回 false 且**不 throw**(`JSON.parse('null')` 會成功,若直接取 `.iat` 會 TypeError)。

### C. 房間碼與路徑安全
- [ ] C1 產生的碼長度正確,且只含指定字母表。
- [ ] C2 合法自訂碼(如 `gary-7x2`)通過;過短 / 含空白 / 含大寫 / 含 `../` 一律不通過。
- [ ] C3 `roomDir` 對合法碼回傳位於 `DATA_DIR` 內的絕對路徑。
- [ ] C4 `roomDir` 對 `../secret`、`bad/../../x` 一律 throw。
- [ ] C5 (路由層)不合法房間碼 → `404`。

### D. 儲存
- [ ] D1 房間不存在時 `listFiles` 回 `[]`(不 throw)。
- [ ] D2 新增後可列出,且排序為**新到舊**。
- [ ] D3 `getFile` 對未知 id 回 `null`;`deleteFile` 同時移除實體檔與 meta 條目。
- [ ] D4 `clearRoom` 移除整個房間資料夾。
- [ ] D5 **併發**:對同一房間同時發出 20 個 `addFileMeta`,最後 `listFiles` 必須有**全部 20 筆**(驗證序列化有生效)。

### E. 路由 / 端到端
- [ ] E1 `POST /new` → `302`,`Location` 符合 `/r/<code>` 格式。
- [ ] E2 **來回完整性**:上傳 → 列出 → 下載,內容 **byte-for-byte 一致**;`Content-Disposition` 含原始檔名。
- [ ] E3 刪除單檔後清單少一筆;清空房間後清單為空。
- [ ] E4 下載未知 id → `404`。
- [ ] E5 超過 `maxFileBytes` 的上傳 → **`413`**(不是 500、不是 hang)。
- [ ] E6 下載回應帶 `X-Content-Type-Options: nosniff`。
- [ ] E7 **(必做,勿跳過)** 非 ASCII 檔名端到端正確。上傳 `客戶報告 2026.txt` 後:
  - `list` 回傳的 `name` **必須完全等於** `'客戶報告 2026.txt'`(不是 mojibake);
  - 下載的 `Content-Disposition` **必須**含 `filename*=UTF-8''%E5%AE%A2%E6%88%B6%E5%A0%B1%E5%91%8A`。
  - 這支測試**必須先失敗**(證明它真的重現了 §2.8 的 latin1 mojibake),修好後才通過。若它在修正前就通過,代表你的測試沒有走到真實路徑 → 修測試,不要宣告勝利。
  - 建議一併涵蓋重音字與 emoji 檔名(如 `émoji-café 🎉.txt`)。

### F. 清理
- [ ] F1 空且逾期的房間會被移除,回傳值含其房間碼。
- [ ] F2 空但未逾期的房間**保留**。
- [ ] F3 逾期但**有檔案**的房間**保留**。

### G. 靜態檢查(人工 review 亦可)
- [ ] G1 前端渲染檔名**必須**用 `textContent` / `createElement`,**不得**用 `innerHTML` 字串拼接(檔名是使用者可控 → stored XSS)。
- [ ] G2 每一個 async route handler 都有被 wrapper 包住,且 error middleware 註冊在所有路由之後。
- [ ] G3 沒有任何一處用使用者輸入(尤其原始檔名)組檔案路徑。
- [ ] G4 錯誤回應不得洩漏 stack trace 或通關碼。

---

## 6. 部署(Windows 常駐;Linux 同理)

1. **Cloudflare Tunnel** — DNS 需託管於 Cloudflare。
   - `cloudflared tunnel create <name>` → 設定 ingress:`<hostname> → http://localhost:3000`,fallback `http_status:404`。
   - `cloudflared tunnel route dns <name> <hostname>` → `cloudflared service install`。
   - **不需要**在路由器/防火牆開任何對外通訊埠。
2. **Node 服務常駐** — Windows 用 `nssm`(或 `node-windows`)註冊成服務,開機自起、崩潰自動重啟;Linux 用 systemd。
   - ⚠️ 用 `nssm` 設定的環境變數會寫進登錄檔,任何有該機器 admin 權限的人都能用 `nssm dump` 讀出來 — 通關碼與 cookie secret 要當作機密看待。
3. README 需記錄完整步驟,換機器可照抄。

---

## 7. 不要做(Out of Scope / YAGNI)

- ❌ 使用者帳號、註冊、OAuth、多租戶
- ❌ WebSocket / SSE 即時推送
- ❌ 資料庫、ORM、migration
- ❌ 獨立的「限時分享連結」token 機制(分享 = 給通關碼 + 房間網址)
- ❌ 傳完即刪 / 檔案定時自動刪除
- ❌ 檔案預覽、縮圖、轉檔
- ❌ 前端框架(原生 HTML + 一支 JS 就夠)

---

## 8. 建議的檔案結構

```
.
├── server.js          # 進入點:loadConfig → ensure DATA_DIR → createApp → trust proxy → 排程清理 → listen
├── app.js             # createApp(config):cookie-parser、noindex、robots、gate、requireAuth、static、掛 router、error middleware
├── lib/
│   ├── config.js      # loadConfig(env) → 設定物件;必填缺少即 throw
│   ├── auth.js        # checkPassphrase / signToken / verifyToken
│   ├── rooms.js       # generateRoomCode / isValidRoomCode / roomDir(路徑守門)
│   ├── storage.js     # ensureRoom / newFileId / addFileMeta / listFiles / getFile / deleteFile / clearRoom(+房間鎖)
│   ├── cleanup.js     # cleanupIdleRooms(dataDir, idleDays, now)
│   └── ratelimit.js   # rateLimiter({ windowMs, max })
├── routes/rooms.js    # roomsRouter(config)
├── public/            # gate.html / index.html / room.html / app.js
├── test/              # 每個 lib 一支 + 路由端到端
└── README.md
```

**注意:** `createApp(config)` 必須接受注入的 config 物件(而非自己讀 env),否則測試無法用不同組態(小 `maxFileBytes`、`secureCookie: false`)建立多個 app 實例。

---

## 9. 給實作 agent 的提醒

- 先寫測試再寫實作(TDD)。上面每條驗收規則都應該對應一支測試。
- **測試全綠 ≠ 做完。收工前一定要真的把 app 跑起來,用瀏覽器(或 `fetch` + `FormData`)走一次真實流程。** 本專案最嚴重的 bug(§2.8 中文檔名)就是「43 支測試全綠但沒人跑過 app」漏掉的。單元測試只會驗你想到的事。
- 測試資料不要只用 ASCII。檔名、內容都該混入中文/重音/emoji — 這類 bug 只在真實資料下現形。
- 跨平台注意:測試裡不要拿 POSIX 字面路徑(`/data`)去跟 `path.resolve` 的結果比對 — Windows 上 `path.resolve('/data')` 會補上磁碟機代號,`path.join('/data')` 不會。要比就兩邊都用 `path.resolve`。
- 本機用 http 測試時記得 `SECURE_COOKIE=false`,否則瀏覽器/supertest 都不會回送 Secure cookie,你會看到「登入成功但一直被踢回 /gate」的鬼打牆。
- 上面標記「必須 / 鐵則 / 注意 / ⚠️」的地方都是實作時真的會踩到的坑,別跳過。
