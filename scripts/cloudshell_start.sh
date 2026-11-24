#!/usr/bin/env bash
# Run from the Baglo repository root in AWS CloudShell; resume safely on reruns.
set -euo pipefail
export AWS_REGION=${AWS_REGION:-us-east-1} AWS_PAGER=''
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
command -v aws >/dev/null || { echo '請在 AWS CloudShell 執行，不需要提供 AK/SK。'; exit 1; }
TARGET_ENV=${1:-dev}
case "$TARGET_ENV" in dev|prod) ;; *) echo '用法：bash scripts/cloudshell_start.sh dev|prod'; exit 2;; esac
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table
# Match this dedicated connection name exactly; do not mutate old CloudQuant connections.
CONNECTIONS=$(aws codeconnections list-connections --region "$AWS_REGION" --query "Connections[?ConnectionName=='baglo-github'].ConnectionArn" --output json)
CONNECTION_ARN=$(python3 -c 'import json,sys; items=json.loads(sys.argv[1]); assert len(items)<=1,"找到多筆 baglo-github，請先確認要使用哪一筆"; print(items[0] if items else "")' "$CONNECTIONS")
if [[ -z "$CONNECTION_ARN" ]]; then
  CONNECTION_ARN=$(aws codeconnections create-connection --region "$AWS_REGION" --provider-type GitHub --connection-name baglo-github --query ConnectionArn --output text)
fi
STATUS=$(aws codeconnections get-connection --region "$AWS_REGION" --connection-arn "$CONNECTION_ARN" --query 'Connection.ConnectionStatus' --output text)
printf 'Connection ARN: %s\n狀態: %s\n' "$CONNECTION_ARN" "$STATUS"
if [[ "$STATUS" != AVAILABLE ]]; then
  printf '\n請開啟：https://%s.console.aws.amazon.com/codesuite/settings/connections\n' "$AWS_REGION"
  echo '選 baglo-github → Update pending connection → 登入 kos8123 → 授權 kos8123/Baglo。'
  printf '完成後重跑：bash scripts/cloudshell_start.sh %s\n' "$TARGET_ENV"
  echo '目前只建立連線，尚未建立金鑰、pipeline 或應用環境。'
  exit 0
fi
# Reuse existing secrets. Never print their values or silently rotate them.
for PROVIDER in gemini fugle; do
  NAME="baglo/$TARGET_ENV/$PROVIDER"
  if ! aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$NAME" --query ARN --output text >/dev/null 2>&1; then
    echo '即將建立後端 Secrets Manager 金鑰；這些 AWS 服務可能計費。輸入內容會隱藏。'
    BAGLO_SKIP_EXISTING_SECRETS=1 bash scripts/setup_secrets.sh "$TARGET_ENV"
    break
  fi
done
PREFIX=$(printf '%s' "$TARGET_ENV" | tr '[:lower:]' '[:upper:]')
for PROVIDER in gemini fugle; do
  ARN=$(aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "baglo/$TARGET_ENV/$PROVIDER" --query ARN --output text)
  SUFFIX=$(printf '%s' "$PROVIDER" | tr '[:lower:]' '[:upper:]')
  export "BAGLO_${PREFIX}_${SUFFIX}_SECRET_ARN=$ARN"
done
export BAGLO_ENVIRONMENTS="$TARGET_ENV"
bash scripts/setup_codepipeline.sh "$CONNECTION_ARN"
printf '\n已提交 %s CI/CD 建置。首次部署請在 CodePipeline 查看 Source、Validate、Deploy 狀態；這行訊息不代表應用部署已成功。\n' "$TARGET_ENV"
