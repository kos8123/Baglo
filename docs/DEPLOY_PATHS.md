# 依程式位置觸發部署

| 變更路徑 | 負責部署 |
| --- | --- |
| `frontend/**`、`functions/**`、`scripts/cloudflare_build.sh`、`scripts/build_frontend.py` | Cloudflare Pages |
| `workers/**`、`wrangler.market-sync.toml` | Cloudflare Worker Builds |
| `backend/**`、`infra/**`、後端 requirements、Python tests、AWS buildspec 與部署腳本 | AWS CodePipeline |
| `README.md`、`docs/**`、圖片 | 不自動部署 |

## AWS

`infra/codepipeline.yaml` 已加入 V2 Git push branch/file-path filters，並關閉 Source 原有 DetectChanges，避免相同 push 觸發兩次。這些設定需透過 `scripts/setup_codepipeline.sh` 更新現有 pipeline stack 才會生效；只 push 程式不會更新 pipeline 自身設定。

如果已設定 `BAGLO_FRONTEND_URL`，AWS 部署只更新後端及檢查該前端 origin 的 CORS，不上傳 S3 網站，也不建立 CloudFront invalidation。未指定外部前端的 AWS 原生部署仍維持 S3 網站流程。

## Cloudflare 需同步設定

Pages 與 Worker Builds 的 Git watch paths 是 Cloudflare 專案設定，僅修改 repository 無法自動套用。請在既有 Git integration 的 Build watch paths 設定：

- Pages Include：`frontend/*`、`functions/*`、`scripts/cloudflare_build.sh`、`scripts/build_frontend.py`。
- Worker Include：`workers/*`、`wrangler.market-sync.toml`。
- 不加入全域 `*`；文件路徑不列入 Include。

參考：[Pages Build watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)。兩套 watch paths 都設定後，前端變更才不會同步觸發 Worker build。
