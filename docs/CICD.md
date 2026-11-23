# Baglo CI/CD 與 Git 工作流

Baglo 使用 GitHub 作為程式碼來源，AWS CodePipeline、CodeBuild、SAM 與 CloudFormation 負責後端驗證及部署。開發環境與正式環境使用不同的 pipeline 與 CloudFormation stack。

## CI/CD Pipeline

![Baglo CI/CD pipeline](architecture/cicd-pipeline.png)

| Git branch | AWS environment | Deployment behavior |
| --- | --- | --- |
| `dev` | `baglo-dev` | 測試成功後自動部署開發環境。 |
| `main` | `baglo-prod` | 測試成功後等待人工核准，再部署正式環境。 |

兩個環境各自擁有 CloudFormation stack、DynamoDB、S3、Cognito 與設定，避免測試資料或錯誤部署影響正式環境。

### AWS 後端流程

1. GitHub 分支異動由 AWS CodeConnections 傳入 CodePipeline。
2. CodeBuild 執行 Python、前端、TypeScript、CloudFormation 與 SAM 驗證。
3. AWS SAM 封裝 Lambda 與 IaC。
4. CloudFormation 更新對應環境的 serverless stack。
5. 正式環境在 CloudFormation 部署前保留人工核准。

### Edge 流程

前端與 Market Sync Worker 依 `dev`／`main` 產生 preview／production 版本。公開設定可以由建置變數注入，但 Gemini、Fugle、Google OAuth Secret 與 AWS 憑證不得進入前端產物。

## GitHub Workflow

![Baglo GitHub development workflow](architecture/github-workflow.png)

1. 從 `dev` 建立短期 `feature/<name>` 分支。
2. 完成功能後先執行本機測試，再建立 Pull Request 到 `dev`。
3. CI 通過且差異確認完成後合併，部署開發環境。
4. 驗證登入、行情、K 線、模擬委託與 AI 流程。
5. 建立 `dev → main` release PR。
6. 完整 CI 與基礎設施差異檢查成功後，人工核准正式部署。
7. 部署後執行 smoke test 並查看 CloudWatch；有問題時重新部署上一個已驗證 commit。

## 第一次建立 Pipeline

在 AWS CloudShell 的 repo 根目錄執行：

```sh
export AWS_REGION=us-east-1
aws sts get-caller-identity --no-cli-pager
aws codeconnections list-connections --region "$AWS_REGION" --output table --no-cli-pager
```

Connection 必須是 `AVAILABLE`，而且 GitHub App 已授權 `kos8123/Baglo`。CLI 可以建立 connection，但 GitHub App 的互動授權仍需在 AWS Console 完成。

建立或更新開發環境：

```sh
bash scripts/setup_secrets.sh dev
# 執行腳本輸出的 Secret ARN exports
export BAGLO_ENVIRONMENTS=dev
bash scripts/setup_codepipeline.sh 'AVAILABLE_CONNECTION_ARN'
```

正式環境應在 `dev` 驗證完成並合併至 `main` 後建立：

```sh
bash scripts/setup_secrets.sh prod
# 執行腳本輸出的 Secret ARN exports
export BAGLO_ENVIRONMENTS=prod
bash scripts/setup_codepipeline.sh 'AVAILABLE_CONNECTION_ARN'
```

## 確認部署

```sh
aws codepipeline get-pipeline-state \
  --region us-east-1 --name baglo-dev-pipeline \
  --query 'stageStates[].{Stage:stageName,Status:latestExecution.status}' \
  --output table --no-cli-pager

aws cloudformation describe-stacks \
  --region us-east-1 --stack-name baglo-dev \
  --query 'Stacks[0].Outputs' --output table --no-cli-pager
```

部署完成必須同時符合：

- Pipeline 的 Source、Validate 與 Deploy 全部成功。
- CloudFormation stack 狀態成功。
- `/api/health` 回傳正確 release 與 `paper_only` 狀態。
- 匿名使用者無法讀取帳戶 API。
- 登入、行情、K 線與模擬委託 smoke test 通過。

## 失敗處理

- Source 找不到 branch：確認 Connection 授權的 repository 與 branch 名稱。
- CodeBuild concurrency：等待進行中的 build 完成，不要同時重複啟動。
- IAM `AccessDenied`：只補上失敗動作需要的最小權限。
- CloudFormation rollback：先讀 stack events，修正 template 或參數，不可刪除帳本規避問題。
- 回退程式：建立 revert commit，再走相同 pipeline；不要 force push `main`。

## 圖片產生方式

CI/CD 與 GitHub Workflow 圖由版本化 HTML 透過 [Takumi CLI](https://takumi.kane.tw/docs/cli) 產生：

```sh
pnpm dlx @takumi-rs/cli@latest image docs/architecture/cicd-pipeline.html \
  -o docs/architecture/cicd-pipeline.png --width 2400 --height 1350

pnpm dlx @takumi-rs/cli@latest image docs/architecture/github-workflow.html \
  -o docs/architecture/github-workflow.png --width 2400 --height 1450
```
