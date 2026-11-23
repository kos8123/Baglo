# Baglo 開發難題與解法

以下整理專案開發期間實際提出並處理的問題。

## 跨網域 API 無法存取

**問題：** 前端網域呼叫 API Gateway 時被瀏覽器 CORS 阻擋。

**解法：** 將實際前端 origin 納入 API Gateway／Lambda CORS 設定，並把匿名行情與 Cognito JWT 保護的帳戶 API 分開。

## K 線載入過慢

**問題：** 第一次開啟 K 線超過十秒，上游 API 也可能限制請求量。

**解法：** 預先整理日、週、月 K 線並保存到 R2。Pages Function 優先讀快取，Market Sync Worker 負責歷史回填與每日增量更新。

## 股票歷史資料缺漏

**問題：** TPEx 曾發生重複導向，部分代號沒有足夠歷史資料，導致 K 線與回測失敗。

**解法：** 加入 timeout、來源驗證與 fallback。AI 選股前檢查代號、名稱、流動性與歷史完整度，不足的標的直接跳過並顯示原因。

## 選股與下單狀態不一致

**問題：** 搜尋到股票後，下單區仍提示未選取；成功委託有時顯示失敗。

**解法：** 遷移至 React 共用狀態，使用 TanStack Query 管理伺服器資料，並以 idempotency key 與明確 API 狀態避免重複委託和錯誤通知。

## 重新整理後資料消失

**問題：** 自選股、AI 候選股與設定只存在瀏覽器記憶體，重新整理後消失。

**解法：** 以 Cognito user sub 區分使用者，將自選股、AI 設定、候選股與執行狀態保存到 DynamoDB。

## 訪客與會員權限衝突

**問題：** 希望訪客能看盤，但交易、帳戶與 AI 功能必須登入。

**解法：** 訪客只開放公開行情路由；註冊、Email 登入、Google OAuth 與 PKCE 交給 Cognito，受保護 API 統一驗證 JWT。

## CI/CD 與 IaC 部署失敗

**問題：** 曾遇到 GitHub Connection 沒有 branch 權限、IAM `AccessDenied`、CodeBuild concurrency 以及 CloudFormation rollback。

**解法：** 使用 CodeConnections、最小權限 IAM、SAM／CloudFormation 預先驗證與 dev／prod 隔離。失敗時先查看 CodeBuild log 與 stack events，只清理已確認為空的殘留資源。

## AI 金鑰、額度與模型失敗

**問題：** 模型可能因金鑰、額度、模型名稱或供應商錯誤而失敗。

**解法：** Secret 集中放在 Secrets Manager，模型名稱改為部署參數；AI 或資料來源失敗時不建立委託，並保存可查詢的失敗原因。

## 成本控制

**問題：** 希望服務以低成本或免費額度為主，但又需要 CI/CD、登入、資料庫、排程與 AI。

**解法：** 採用 serverless 與按量計費服務，將高頻 K 線讀取移至快取；dev／prod 分開建立，排程預設關閉，正式功能確認後才啟用。
