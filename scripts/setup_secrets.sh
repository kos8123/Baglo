#!/usr/bin/env bash
# CloudShell: securely create/update a single environment's backend secrets.
set -euo pipefail
TARGET_ENV=${1:?Usage: bash scripts/setup_secrets.sh dev|prod}
case "$TARGET_ENV" in dev|prod) ;; *) exit 2;; esac
export AWS_REGION=${AWS_REGION:-us-east-1} AWS_PAGER=''
command -v aws >/dev/null
TMP_SECRET=$(mktemp)
chmod 600 "$TMP_SECRET"
trap 'rm -f "$TMP_SECRET"' EXIT
for PROVIDER in gemini fugle; do
  SECRET_NAME="baglo/$TARGET_ENV/$PROVIDER"
  if [[ "${BAGLO_SKIP_EXISTING_SECRETS:-0}" == 1 ]]; then
    EXISTING_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" --query ARN --output text 2>/dev/null || true)
    if [[ -n "$EXISTING_ARN" && "$EXISTING_ARN" != None ]]; then
      LABEL=$(printf '%s_%s' "$TARGET_ENV" "$PROVIDER" | tr '[:lower:]' '[:upper:]')
      printf 'export BAGLO_%s_SECRET_ARN=%q\n' "$LABEL" "$EXISTING_ARN"
      continue
    fi
  fi
  read -r -s -p "Enter $TARGET_ENV $PROVIDER API key (hidden): " API_VALUE < /dev/tty
  printf '\n' > /dev/tty
  [[ -n "$API_VALUE" ]] || { echo 'Empty key rejected'; exit 1; }
  printf '%s' "$API_VALUE" > "$TMP_SECRET"
  unset API_VALUE
  if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
    ARN=$(aws secretsmanager put-secret-value --secret-id "$SECRET_NAME" --secret-string "file://$TMP_SECRET" --region "$AWS_REGION" --query ARN --output text)
  else
    ARN=$(aws secretsmanager create-secret --name "$SECRET_NAME" --secret-string "file://$TMP_SECRET" --region "$AWS_REGION" --query ARN --output text)
  fi
  : > "$TMP_SECRET"
  LABEL=$(printf '%s_%s' "$TARGET_ENV" "$PROVIDER" | tr '[:lower:]' '[:upper:]')
  printf 'export BAGLO_%s_SECRET_ARN=%q\n' "$LABEL" "$ARN"
done
