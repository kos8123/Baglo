# Baglo雲端架構

Baglo是台股AI研究與模擬交易平台。系統只建立虛擬資金、持倉與委託，不串接券商，也不送出真實交易。

## High-Level Architecture

![Baglo high-level AWS architecture](architecture/high-level-baglo-architecture.png)

- Edge層提供React前端、Pages Functions、R2 K線快取與Market Sync Worker。
- Amazon Cognito處理Email／密碼及Google OAuth。
- API Gateway與API Lambda提供公開行情及受JWT保護的帳戶功能。
- DynamoDB保存模擬帳務、自選股與AI執行狀態。
- S3保存研究、回測、報告與稽核資料。
- EventBridge啟動盤前分析、股票選擇與AI模擬交易流程。
- TWSE、TPEx、Fugle、Google OAuth與Gemini是AWS外部服務。
- GitHub、CodePipeline、CodeBuild與CloudFormation負責環境隔離的部署流程。

## Low-Level Architecture

![Baglo low-level AWS architecture](architecture/baglo-low-level-architecture.png)

### Client and edge

- 瀏覽器載入React／TypeScript SPA。
- Pages Function從R2讀取預先整理的日、週、月K線。
- Market Sync Worker負責歷史回填及收盤後增量更新。

### Identity and synchronous API

- Cognito使用OAuth authorization-code flow with PKCE發出JWT。
- Google登入接受任何email已驗證的Google帳號（`BAGLO_GOOGLE_OPEN_SIGNUP`），讓面試官能直接用自己的帳號登入；不會用email合併既有帳號。
- API Gateway將公開路由與受保護路由分開。
- API Lambda處理帳戶、虛擬資金、持倉、委託、自選股、AI設定與研究結果。

### 模擬撮合

- 委託為當日有效（ROD）；收盤後或假日下的單，歸到下一個交易日。
- 當日委託用富果1分K判斷，從下單後的下一分鐘開始：買單最低價碰到限價、賣單最高價碰到限價就全數成交；若開盤價已優於限價，以開盤價成交。
- 跨日委託以證交所／櫃買中心官方日K判斷；收盤仍未成交即失效並退回保留資金。
- 讀取帳戶時與盤中排程（每5分鐘）都會撮合；行情取得失敗時保持待成交，不猜測結果。

### Scheduled AI workflow

```text
EventBridge → Premarket Analysis → Stock Selection → AI Trading Worker
```

- Premarket Analysis整理技術面、基本面與籌碼面資料。
- Stock Selection驗證資料完整度、評分多檔高流動性股票並呼叫Gemini。
- AI Trading Worker套用信心、資金、曝險與持倉限制後建立模擬委託。
- 任一資料、模型或風控步驟失敗時不建立委託，並保存失敗原因。
- AI一鍵選股交易（`POST /api/ai/pick-and-trade`）：API Lambda只建立工作並非同步呼叫AI Worker，避免超過API Gateway的逾時。Worker從流動性初篩取前10檔（含持股），整理近期價量與均線後只呼叫一次Gemini比較全部候選，選出最多3檔；信心達門檻者立即建立模擬委託，盤中用即時價，非交易時段用最近參考價掛下一個交易日的限價單。每帳號每天最多10次，與單檔分析共用上限。
- 初篩的資料新鮮度依交易所分別判斷：證交所收盤資料比櫃買中心晚一天公布，若用全市場同一日期，上市股票會整天被排除。
- 排程對象：`AiAccounts`可填指定帳號，或填`*`開放給所有登入使用者。開放模式下，使用者打開自動交易開關時才寫入DynamoDB的名單紀錄，排程只讀這份名單，不掃整張表；名額上限預設20個帳號，每個帳號每天每檔只呼叫一次模型，費用有上限。

### Data, security and operations

- DynamoDB保存使用者、虛擬資金、持倉、委託、自選股、AI設定與idempotency records。
- S3保存研究快照、AI報告、回測及稽核資料。
- Secrets Manager保存Gemini、Fugle與Google OAuth Secret。
- CloudWatch保存Lambda日誌及部署後診斷資訊。
- 瀏覽器與公開前端不得取得後端Secret。

## 架構限制

- 行情可能受第三方API延遲、額度、缺漏或中斷影響。
- 模擬成交不模擬排隊順序與部分成交（碰到限價即全數成交，結果略偏樂觀），也未還原T+2交割、除權息等公司行動與所有市場特例。
- AI輸出必須通過程式化風控，且不保證正確或獲利。
- 系統不具券商連線、真實資金或金融資產保管功能。
