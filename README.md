# Baglo

Baglo是台股AI研究與模擬交易平台，用於展示Serverless雲端架構、CI/CD與AI輔助開發。

> 只提供模擬交易，不連接券商、不使用真實資金，也不構成投資建議。

## 開發理念
有時候人類在交易的時候，沒有辦法做到很標準的停損停利，或者是因為人類因為自身情緒的波動，導致自己操作失誤。人終究思考的能力還是有限，不如來讓AI規劃看看策略，讓AI能夠自動交易! 順便增進自己的技術!

## 主要功能

- 訪客可搜尋台股，查看價格與日／週／月K線。
- Cognito帳號註冊、密碼登入與Google登入。
- 整股、零股模擬下單，含漲跌停、費稅與重複請求防護。
- 資金、持倉、委託與取消紀錄。
- 技術面、基本面、籌碼面資料與AI模擬建議。
- AI自動交易與回測流程；未通過資料、信心或風控條件時不建單。

## 雲端架構

- **Frontend:** React、TypeScript、Vite、TanStack Query、Lightweight Charts
- **Hosting:** Cloudflare Pages、R2 K線快取與Worker每日預填
- **Backend:** Python 3.12、AWS Lambda、API Gateway
- **Identity:** Cognito + Google OAuth
- **Storage:** DynamoDB、S3
- **IaC / CI/CD:** AWS SAM / CloudFormation、CodePipeline、CodeBuild
- **Data / AI:** TWSE、TPEx、Fugle、Gemini

### 為什麼選這些雲端服務？
一開始其實與AI討論了很久架構的問題，因為我知道架構一旦訂下去，要整個重改很花時間，所以花了蠻多時間在選用服務。
先講整體思路：Baglo目前是開發給自身投資用的，使用者沒有到很多，大部分時間其實沒人在用，只有開盤前後和有人登入下單時才會忙一下。會選這些服務是因為：**盡量將成本壓低，同時希望效能平衡，最重要的是轉換不同的思路，使用每個服務能達到的效果都不一樣，成本也不一樣，這就是架構師好玩的地方。**

| 服務 | 用在哪 | 為什麼選它 |
| --- | --- | --- |
| **AWS Lambda** | 主要跑Python後端API | 有請求才執行、按次計費，沒人用就不花錢。如果是開一台EC2放著，就算整天沒人用也要付錢，還得自己更新系統、處理擴展。 |
| **API Gateway** | 後端API的入口 | 跟Lambda是標準組合，最重要的是可以直接幫我驗Cognito發的JWT。|
| **Amazon Cognito** | 主要處理註冊、登入、第三方登入 | 使用Cognito能夠節省掉自己做登入的流程，例如: 處理密碼加密、Token、OAuth流程，很容易出安全漏洞。Cognito內建這些功能，也支援PKCE，我就不用自己保存任何密碼。 |
| **DynamoDB** | 存帳戶、持倉、委託、自選股 | 資料幾乎都是「用使用者ID查自己的東西」，我認為用key-value查詢就夠了，不需要使用到RDBMS。使用RDBMS還要架EC2或用RDS，成本也會提高一層。 |
| **Amazon S3** | 主要存一些靜態的AI研究報告、回測結果、稽核紀錄 | 這些是比較大、寫了就很少改的檔案，放資料庫不划算。 |
| **EventBridge** | 每天盤前定時啟動AI分析與選股 | 就是雲端排程器（cron），時間到就觸發Lambda。 |
| **Secrets Manager** | 存Gemini、Fugle、Google OAuth金鑰 | 現在那麼講究資安的世代，絕對不能寫進程式碼或推上GitHub。放在這裡，Lambda執行時才去讀，權限也可以只開給需要的函式。 |
| **CloudWatch** | 看Lambda日誌、查錯誤 | Lambda預設的log就會寫進來，debug就直接查log。日誌設定保存7天，避免存太多產生費用。 |
| **Cloudflare Pages + R2 + Workers** | 放前端網站、快取K線資料 | 前端是靜態網站，Pages免費又有全球CDN。K線是讀取最頻繁的資料，如果每次都打AWS或第三方API，又慢又容易被限流（一開始真的要等十幾秒）。所以我讓Worker每天收盤後先把K線整理好存進R2，前端直接讀快取。R2不收流出流量費，很適合這種讀很多次的資料。 |
| **CloudFormation / SAM** | IaC，用程式碼定義整套AWS架構 | 我相信大家都有在Console點設定點錯過吧，使用IaC能夠減少這些失誤。而且在寫成template之後，`dev`和`prod`可以用同一份檔案建出兩套一模一樣但互相隔離的環境，每次修改也都留在Git紀錄裡。 |
| **CodePipeline + CodeBuild** | 自動測試與部署 | 推到`dev`會自動跑測試並部署測試環境；推到`main`要等人工核准才上正式環境。全部在AWS裡完成，可以直接用IAM角色部署，不用把AWS金鑰存到外部CI平台。 |

簡單說：**後端全部放AWS，用serverless降低成本和維運負擔；前端和高頻讀取的行情資料放Cloudflare，讓網頁和K線載入得更快。**

![Baglo high-level cloud architecture](docs/architecture/high-level-baglo-architecture.png)

圖中的AWS服務圖示取自[AWS Architecture Icons](https://aws.amazon.com/architecture/icons/)；Cloudflare、GitHub、Google與資料供應商以中性方塊表示，避免誤認為AWS服務。

## 文件導覽

| 文件 | 內容 |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | High／Low Level架構圖、元件責任、資料流、安全邊界與系統限制 |
| [CICD.md](docs/CICD.md) | CI/CD Pipeline與GitHub Workflow圖、分支與環境、部署驗證、失敗處理與回退 |
| [CHALLENGES.md](docs/CHALLENGES.md) | 開發中實際遇到的問題：發現問題 → 發生原因 → 解法 |

## 本機啟動

需要Python 3.12、Node.js 24與pnpm。

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
pnpm --dir frontend install --frozen-lockfile
python scripts/build_frontend.py
PYTHONPATH=backend python -m baglo.local --demo --port 8000
```

開啟<http://127.0.0.1:8000>。

## 測試

```bash
python -m pytest -q
node --experimental-strip-types --test tests/*.test.ts
cfn-lint infra/template.yaml infra/bootstrap.yaml infra/codepipeline.yaml
```

## AI輔助開發

使用Codex協助需求拆解、程式實作、測試、除錯與雲端部署；權限、帳務與部署結果仍透過自動測試與人工驗證。
