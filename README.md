# Baglo

Baglo 是台股 AI 研究與模擬交易平台，用於展示 Serverless 雲端架構、CI/CD 與 AI 輔助開發。

> 只提供模擬交易，不連接券商、不使用真實資金，也不構成投資建議。

## 主要功能

- 訪客可搜尋台股，查看價格與日／週／月 K 線。
- Cognito 帳號註冊、密碼登入與 Google 登入。
- 整股、零股模擬下單，含漲跌停、費稅與重複請求防護。
- 資金、持倉、委託與取消紀錄。
- 技術面、基本面、籌碼面資料與 AI 模擬建議。
- AI 自動交易與回測流程；未通過資料、信心或風控條件時不建單。

## 雲端架構

- **Frontend:** React、TypeScript、Vite、TanStack Query、Lightweight Charts
- **Hosting:** Cloudflare Pages、R2 K 線快取與 Worker 每日預填
- **Backend:** Python 3.12、AWS Lambda、API Gateway
- **Identity:** Cognito + Google OAuth
- **Storage:** DynamoDB、S3
- **IaC / CI/CD:** AWS SAM / CloudFormation、CodePipeline、CodeBuild
- **Data / AI:** TWSE、TPEx、Fugle、Gemini

### 為什麼選這些雲端服務？

先講整體思路：Baglo 是個人作品，使用者不多、流量也不固定，大部分時間其實沒人在用，只有開盤前後和有人登入下單時才會忙一下。所以我選服務的原則很簡單：**沒人用的時候不要花錢、不要自己顧伺服器，而且整套環境要能用程式碼一鍵重建。**

| 服務 | 用在哪 | 為什麼選它 |
| --- | --- | --- |
| **AWS Lambda** | 跑 Python 後端 API 和排程任務 | 有請求才執行、按次計費，沒人用就不花錢。如果開一台 EC2 放著，就算整天沒人用也要付錢，還得自己更新系統、處理擴展。Lambda 這些都不用管，我可以專心寫交易邏輯。 |
| **API Gateway** | 後端 API 的入口 | 跟 Lambda 是標準組合，而且可以直接幫我驗證 Cognito 發的 JWT。公開的行情 API 跟要登入的帳戶 API 在這一層就分開了，不用每支程式自己檢查。 |
| **Amazon Cognito** | 註冊、登入、Google 登入 | 自己做登入要處理密碼加密、Token、OAuth 流程，很容易出安全漏洞。Cognito 內建這些功能，也支援 PKCE，我就不用自己保存任何密碼。 |
| **DynamoDB** | 存帳戶、持倉、委託、自選股 | 資料幾乎都是「用使用者 ID 查自己的東西」，用 key-value 查詢就夠了，不需要複雜的 JOIN。它是 serverless、按用量計費，不用一直開著 RDS。另外它支援條件寫入，我用版本號確保同一筆資金不會被重複扣款或重複下單。 |
| **Amazon S3** | 存 AI 研究報告、回測結果、稽核紀錄 | 這些是比較大、寫了就很少改的檔案，放資料庫不划算。S3 便宜又耐用，我也開了版本控制，誤刪還救得回來。 |
| **EventBridge** | 每天盤前定時啟動 AI 分析與選股 | 就是雲端版的排程器（cron），時間到觸發 Lambda，不用為了「每天跑一次」一直開著一台機器。 |
| **Secrets Manager** | 存 Gemini、Fugle、Google OAuth 金鑰 | 金鑰絕對不能寫進程式碼或推上 GitHub。放在這裡，Lambda 執行時才去讀，權限也可以只開給需要的函式。 |
| **CloudWatch** | 看 Lambda 日誌、查錯誤 | Lambda 預設就會寫進來，出問題時直接查 log。日誌設定保存 7 天，避免存太多產生費用。 |
| **Cloudflare Pages + R2 + Workers** | 放前端網站、快取 K 線資料 | 前端是靜態網站，Pages 免費又有全球 CDN。K 線是讀取最頻繁的資料，如果每次都打 AWS 或第三方 API，又慢又容易被限流（一開始真的要等十幾秒）。所以我讓 Worker 每天收盤後先把 K 線整理好存進 R2，前端直接讀快取。R2 不收流出流量費，很適合這種讀很多次的資料。 |
| **CloudFormation / SAM** | IaC，用程式碼定義整套 AWS 架構 | 手動在 Console 點設定很難重現，也容易漏東西。寫成 template 之後，`dev` 和 `prod` 可以用同一份檔案建出兩套一模一樣但互相隔離的環境，每次修改也都留在 Git 紀錄裡。 |
| **CodePipeline + CodeBuild** | 自動測試與部署 | 推到 `dev` 會自動跑測試並部署測試環境；推到 `main` 要等人工核准才上正式環境。全部在 AWS 裡完成，可以直接用 IAM 角色部署，不用把 AWS 金鑰存到外部 CI 平台。 |

簡單說：**後端全部放 AWS，用 serverless 降低成本和維運負擔；前端和高頻讀取的行情資料放 Cloudflare，讓網頁和 K 線載入得更快。**

![Baglo high-level cloud architecture](docs/architecture/high-level-baglo-architecture.png)

圖中的 AWS 服務圖示取自 [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/)；Cloudflare、GitHub、Google 與資料供應商以中性方塊表示，避免誤認為 AWS 服務。

## 文件導覽

| 文件 | 內容 |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | High／Low Level 架構圖、元件責任、資料流、安全邊界與系統限制 |
| [CICD.md](docs/CICD.md) | CI/CD Pipeline 與 GitHub Workflow 圖、分支與環境、部署驗證、失敗處理與回退 |
| [CHALLENGES.md](docs/CHALLENGES.md) | 開發中實際遇到的問題：發現問題 → 發生原因 → 解法 |

## 本機啟動

需要 Python 3.12、Node.js 24 與 pnpm。

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
pnpm --dir frontend install --frozen-lockfile
python scripts/build_frontend.py
PYTHONPATH=backend python -m baglo.local --demo --port 8000
```

開啟 <http://127.0.0.1:8000>。

## 測試

```bash
python -m pytest -q
node --experimental-strip-types --test tests/*.test.ts
cfn-lint infra/template.yaml infra/bootstrap.yaml infra/codepipeline.yaml
```

## AI 輔助開發

使用 Codex 協助需求拆解、程式實作、測試、除錯與雲端部署；權限、帳務與部署結果仍透過自動測試與人工驗證。
