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
- API Gateway將公開路由與受保護路由分開。
- API Lambda處理帳戶、虛擬資金、持倉、委託、自選股、AI設定與研究結果。

### Scheduled AI workflow

```text
EventBridge → Premarket Analysis → Stock Selection → AI Trading Worker
```

- Premarket Analysis整理技術面、基本面與籌碼面資料。
- Stock Selection驗證資料完整度、評分多檔高流動性股票並呼叫Gemini。
- AI Trading Worker套用信心、資金、曝險與持倉限制後建立模擬委託。
- 任一資料、模型或風控步驟失敗時不建立委託，並保存失敗原因。

### Data, security and operations

- DynamoDB保存使用者、虛擬資金、持倉、委託、自選股、AI設定與idempotency records。
- S3保存研究快照、AI報告、回測及稽核資料。
- Secrets Manager保存Gemini、Fugle與Google OAuth Secret。
- CloudWatch保存Lambda日誌及部署後診斷資訊。
- 瀏覽器與公開前端不得取得後端Secret。

## 架構限制

- 行情可能受第三方API延遲、額度、缺漏或中斷影響。
- 模擬成交尚未完整還原委託簿、T+2交割、除權息等公司行動與所有市場特例。
- AI輸出必須通過程式化風控，且不保證正確或獲利。
- 系統不具券商連線、真實資金或金融資產保管功能。
