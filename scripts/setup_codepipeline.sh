#!/usr/bin/env bash
# Run from this repository in AWS CloudShell. This provisions NEW Baglo resources only.
set -euo pipefail
CONNECTION_ARN=${1:?Usage: bash scripts/setup_codepipeline.sh AVAILABLE_CONNECTION_ARN}
export AWS_REGION=${AWS_REGION:-us-east-1} AWS_PAGER=''
command -v aws >/dev/null || { echo 'Run this script in AWS CloudShell (AWS CLI required).'; exit 1; }
[[ $CONNECTION_ARN == arn:*:*:$AWS_REGION:*:connection/* ]] || { echo 'Connection ARN region must match AWS_REGION'; exit 1; }
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table
echo 'Baglo-only serverless resources will be created/updated; schedules remain disabled by default.'
export AWS_PAGER=''
STATUS=$(aws codeconnections get-connection --region "$AWS_REGION" --connection-arn "$CONNECTION_ARN" --query 'Connection.ConnectionStatus' --output text)
[[ "$STATUS" == AVAILABLE ]] || { echo 'GitHub connection must be AVAILABLE and allow kos8123/Baglo.'; exit 1; }
get_output() { aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text; }
for TARGET_ENV in ${BAGLO_ENVIRONMENTS:-dev}; do
  case "$TARGET_ENV" in dev|prod) ;; *) echo "Environment must be dev or prod"; exit 2;; esac
  SECRET_PREFIX=$(printf '%s' "$TARGET_ENV" | tr '[:lower:]' '[:upper:]')
  GEMINI_VAR="BAGLO_${SECRET_PREFIX}_GEMINI_SECRET_ARN"
  FUGLE_VAR="BAGLO_${SECRET_PREFIX}_FUGLE_SECRET_ARN"
  existing_parameter() {
    local VALUE
    VALUE=$(aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "baglo-$TARGET_ENV-pipeline" --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue | [0]" --output text 2>/dev/null || true)
    [[ "$VALUE" == None ]] && VALUE=''
    printf '%s' "$VALUE"
  }
  if [[ ${!GEMINI_VAR+x} == x ]]; then GEMINI_SECRET=${!GEMINI_VAR}; else GEMINI_SECRET=$(existing_parameter GeminiSecretArn); fi
  if [[ ${!FUGLE_VAR+x} == x ]]; then FUGLE_SECRET=${!FUGLE_VAR}; else FUGLE_SECRET=$(existing_parameter FugleSecretArn); fi
  GEMINI_MODEL=${BAGLO_GEMINI_MODEL:-$(existing_parameter GeminiModel)}
  GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.5-flash-lite}
  AI_SCHEDULE=${BAGLO_AI_SCHEDULE:-$(existing_parameter AiSchedule)}
  AI_SCHEDULE=${AI_SCHEDULE:-DISABLED}
  AI_ACCOUNTS=${BAGLO_AI_ACCOUNTS-$(existing_parameter AiAccounts)}
  GOOGLE_VAR="BAGLO_${SECRET_PREFIX}_GOOGLE_OAUTH_SECRET_ARN"
  GOOGLE_VERSION_VAR="BAGLO_${SECRET_PREFIX}_GOOGLE_OAUTH_SECRET_VERSION"
  if [[ ${!GOOGLE_VAR+x} == x ]]; then GOOGLE_SECRET=${!GOOGLE_VAR}; else GOOGLE_SECRET=$(existing_parameter GoogleOAuthSecretArn); fi
  if [[ ${!GOOGLE_VERSION_VAR+x} == x ]]; then GOOGLE_VERSION=${!GOOGLE_VERSION_VAR}; else GOOGLE_VERSION=$(existing_parameter GoogleOAuthSecretVersion); fi
  BOOTSTRAP="baglo-$TARGET_ENV-bootstrap"
  if aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$BOOTSTRAP" >/dev/null 2>&1; then
    OIDC=$(aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$BOOTSTRAP" --query "Stacks[0].Parameters[?ParameterKey=='ExistingOidcProviderArn'].ParameterValue | [0]" --output text)
    [[ "$OIDC" == None ]] && OIDC=''
  else
    OIDC=$(aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[?contains(Arn, `token.actions.githubusercontent.com`)].Arn | [0]' --output text)
    [[ "$OIDC" == None ]] && OIDC=''
  fi
  aws cloudformation deploy --region "$AWS_REGION" --stack-name "$BOOTSTRAP" --template-file infra/bootstrap.yaml --capabilities CAPABILITY_IAM --parameter-overrides "Environment=$TARGET_ENV" "Repository=kos8123/Baglo" "ExistingOidcProviderArn=$OIDC" "GoogleOAuthSecretArn=$GOOGLE_SECRET" --no-fail-on-empty-changeset
  ROLE=$(get_output "$BOOTSTRAP" DeployRoleArn)
  CFN=$(get_output "$BOOTSTRAP" CloudFormationRoleArn)
  BUCKET=$(get_output "$BOOTSTRAP" ArtifactBucket)
  aws cloudformation deploy --region "$AWS_REGION" --stack-name "baglo-$TARGET_ENV-pipeline" --template-file infra/codepipeline.yaml --capabilities CAPABILITY_IAM --parameter-overrides "Environment=$TARGET_ENV" "ConnectionArn=$CONNECTION_ARN" "ArtifactBucket=$BUCKET" "DeployRoleArn=$ROLE" "CloudFormationRoleArn=$CFN" "FugleSecretArn=$FUGLE_SECRET" "GoogleOAuthSecretArn=$GOOGLE_SECRET" "GoogleOAuthSecretVersion=$GOOGLE_VERSION" "GeminiSecretArn=$GEMINI_SECRET" "GeminiModel=$GEMINI_MODEL" "OpenAISecretArn=${BAGLO_OPENAI_SECRET_ARN:-}" "OpenAIModel=${BAGLO_OPENAI_MODEL:-gpt-4.1-mini}" "AiAccounts=$AI_ACCOUNTS" "AiSchedule=$AI_SCHEDULE" --no-fail-on-empty-changeset
  get_output "baglo-$TARGET_ENV-pipeline" ConsoleUrl
done
