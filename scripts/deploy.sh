#!/usr/bin/env bash
set -euo pipefail
ENVIRONMENT=${1:?Usage: deploy.sh dev|prod}
case "$ENVIRONMENT" in dev|prod) ;; *) exit 2;; esac
: "${AWS_REGION:?AWS_REGION required}"
: "${BAGLO_CFN_ROLE_ARN:?CloudFormation execution role required}"
: "${BAGLO_ARTIFACT_BUCKET:?Bootstrap artifact bucket required}"
[[ "${BAGLO_PREBUILT_FRONTEND:-0}" == 1 ]] || { echo "Deploy only the validated CodePipeline artifact (BAGLO_PREBUILT_FRONTEND=1)."; exit 1; }
STACK="baglo-$ENVIRONMENT"
RELEASE=$(python3 scripts/release_manifest.py verify)
sam build --template-file infra/template.yaml
PARAMETERS=("Environment=$ENVIRONMENT" "PremarketScheduleState=${BAGLO_AI_SCHEDULE:-DISABLED}" "GeminiModel=${BAGLO_GEMINI_MODEL:-gemini-3.5-flash-lite}" "ReleaseId=$RELEASE" "OpenAIModel=${BAGLO_OPENAI_MODEL:-gpt-4.1-mini}")
# SAM rejects Key= with an empty value. Omitted optional values use template defaults
# on first deployment and preserve existing parameters on subsequent deployments.
for PAIR in "GoogleOAuthSecretArn=${BAGLO_GOOGLE_OAUTH_SECRET_ARN:-}" "GoogleOAuthSecretVersion=${BAGLO_GOOGLE_OAUTH_SECRET_VERSION:-}" "FugleSecretArn=${BAGLO_FUGLE_SECRET_ARN:-}" "GeminiSecretArn=${BAGLO_GEMINI_SECRET_ARN:-}" "OpenAISecretArn=${BAGLO_OPENAI_SECRET_ARN:-}" "AiAccounts=${BAGLO_AI_ACCOUNTS:-}"; do
  [[ -z "${PAIR#*=}" ]] || PARAMETERS+=("$PAIR")
done
ROLLBACK_OPTIONS=()
# Keep failed dev resources for in-place repair; production retains normal rollback.
[[ "$ENVIRONMENT" != dev ]] || ROLLBACK_OPTIONS+=(--disable-rollback)
sam deploy --stack-name "$STACK" --region "$AWS_REGION" \
  --s3-bucket "$BAGLO_ARTIFACT_BUCKET" --capabilities CAPABILITY_IAM \
  --role-arn "$BAGLO_CFN_ROLE_ARN" \
  --parameter-overrides "${PARAMETERS[@]}" "${ROLLBACK_OPTIONS[@]}" \
  --no-confirm-changeset --no-fail-on-empty-changeset
OUTPUT_FILE=$(mktemp)
HEALTH_FILE=$(mktemp)
RELEASE_FILE=$(mktemp)
trap 'rm -f "$OUTPUT_FILE" "$HEALTH_FILE" "$RELEASE_FILE"' EXIT
aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" --output json > "$OUTPUT_FILE"
read_output() { python3 -c 'import json,sys; o=json.load(open(sys.argv[1]))["Stacks"][0]["Outputs"]; print(next(x["OutputValue"] for x in o if x["OutputKey"]==sys.argv[2]))' "$OUTPUT_FILE" "$1"; }
API_URL=$(read_output ApiUrl)
BUCKET=$(read_output WebsiteBucket)
DISTRIBUTION=$(read_output DistributionId)
WEBSITE=$(read_output WebsiteUrl)
python3 scripts/configure_frontend.py --api-base "$API_URL"
# Versioned bucket retains replaced assets. Keep only these known public files.
aws s3 sync dist/ "s3://$BUCKET/" --cache-control 'no-cache' --region "$AWS_REGION"
INVALIDATION=$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths '/*' --query 'Invalidation.Id' --output text)
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION" --id "$INVALIDATION"
curl --fail --silent --show-error --retry 3 --max-time 15 "$API_URL/api/health" > "$HEALTH_FILE"
curl --fail --silent --show-error --retry 3 --max-time 15 "$WEBSITE/config.json"
# Authenticated account behavior is covered in tests; an unauthenticated request must fail.
STATUS=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 "$API_URL/api/account")
[[ "$STATUS" == 401 ]] || { echo "Expected unauthenticated account to return 401, got $STATUS"; exit 1; }
aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text
curl --fail --silent --show-error --max-time 15 "$WEBSITE/release.json" > "$RELEASE_FILE"
python3 - "$RELEASE_FILE" "$RELEASE" "$HEALTH_FILE" <<'PYCODE'
import json,sys
if json.load(open(sys.argv[1]))['commit']!=sys.argv[2]:raise SystemExit('Frontend release does not match validated commit')
health=json.load(open(sys.argv[3]))
if health.get('ok') is not True or health.get('trading')!='paper_only' or health.get('release')!=sys.argv[2]:raise SystemExit('Backend health/release does not match validated commit')
PYCODE
rm -f "$RELEASE_FILE"
PREFLIGHT_HEADERS=$(mktemp)
PREFLIGHT_STATUS=$(curl --silent --show-error --max-time 15 --request OPTIONS --header "Origin: $WEBSITE" --header 'Access-Control-Request-Method: POST' --header 'Access-Control-Request-Headers: authorization,content-type,idempotency-key' --dump-header "$PREFLIGHT_HEADERS" --output /dev/null --write-out '%{http_code}' "$API_URL/api/orders")
python3 - "$PREFLIGHT_HEADERS" "$PREFLIGHT_STATUS" "$WEBSITE" <<'PYCORS'
import sys
from email.parser import Parser
raw=open(sys.argv[1]).read().split('\n',1)[1]
headers=Parser().parsestr(raw)
if sys.argv[2] not in ('200','204'):raise SystemExit('Browser CORS preflight failed: '+sys.argv[2])
if headers.get('access-control-allow-origin')!=sys.argv[3]:raise SystemExit('CORS origin mismatch')
allowed={x.strip().lower() for x in headers.get('access-control-allow-headers','').split(',')}
if not {'authorization','content-type','idempotency-key'}<=allowed:raise SystemExit('CORS request headers missing')
PYCORS
rm -f "$PREFLIGHT_HEADERS"
echo "Deployed $ENVIRONMENT commit $RELEASE: $WEBSITE"
