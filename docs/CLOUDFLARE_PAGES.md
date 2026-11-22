# Cloudflare Pages 前端部署

Baglo 採混合架構：Cloudflare Pages 只託管公開靜態前端；API、Cognito、Lambda、DynamoDB 與 Secrets Manager 保留在 AWS。前端不得保存 Gemini、富果、Google OAuth Secret 或 AWS 憑證。

## 建立 Pages 專案

在 Cloudflare Dashboard 選擇 **Workers & Pages → Create application → Pages → Connect to Git**，只授權 GitHub repository `kos8123/Baglo`。

建議設定：

| 欄位 | 值 |
|---|---|
| Project name | `baglo`（若已被使用，可用 `baglo-tw`） |
| Production branch | `main` |
| Preview branches | `dev` |
| Framework preset | None |
| Root directory | `/` |
| Build command | `bash scripts/cloudflare_build.sh` |
| Build output directory | `dist` |
| Node version | `24` |

Production 與 Preview 都設定公開環境變數：

```text
BAGLO_API_BASE=https://5ck9jrcbe3.execute-api.us-east-1.amazonaws.com
NODE_VERSION=24
```

`BAGLO_API_BASE` 是公開 API Gateway 網址，不是密鑰。Cloudflare Pages 會把 `home.html` 發布成網站根目錄，把交易工作台發布為 `/terminal.html`，並保留 `/privacy.html` 與 `/terms.html`。

## 將 Pages 網址加入 AWS

第一次部署完成並取得固定網址（例如 `https://baglo.pages.dev`）後，從可信任的 CloudShell 執行：

```bash
export BAGLO_DEV_FRONTEND_URL=https://baglo.pages.dev
bash scripts/setup_codepipeline.sh arn:aws:codeconnections:us-east-1:967417234835:connection/b377973f-b1a0-45fe-9924-75d841c561ac
aws codepipeline start-pipeline-execution --region us-east-1 --name baglo-dev-pipeline
```

這會將 Pages origin 加入 API CORS，並把 `${BAGLO_DEV_FRONTEND_URL}/terminal.html` 加入 Cognito callback URL。正式區使用 `BAGLO_PROD_FRONTEND_URL`，且應使用正式 domain。

## Google OAuth 與自訂網域

Google OAuth 的 Authorized redirect URI 仍是 Cognito 的 `/oauth2/idpresponse`，不改成 Cloudflare Pages。OAuth consent screen 可填：

- Application home page：Pages 根網址
- Privacy policy：`/privacy.html`
- Terms of service：`/terms.html`

若要使用真正的自訂網域，需先持有該網域，再於 Pages 專案的 **Custom domains** 新增。換網域後也要重新設定 `BAGLO_DEV_FRONTEND_URL` 或 `BAGLO_PROD_FRONTEND_URL`，否則 Cognito callback 與 API CORS 會拒絕新來源。

## 切換與回復

CloudFront 與私人 WebsiteBucket 暫時保留作回復備援。確認 Pages 登入、API、隱私權頁面與交易工作台都正常後，再另行決定是否移除舊前端資源；不要在遷移同一批變更中刪除。
