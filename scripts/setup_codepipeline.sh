#!/usr/bin/env bash
# Run from this repository in AWS CloudShell. This provisions NEW Baglo resources only.
set -euo pipefail
CONNECTION_ARN=${1:?Usage: bash scripts/setup_codepipeline.sh AVAILABLE_CONNECTION_ARN}
AWS_REGION=${AWS_REGION:-us-east-1}
export AWS_PAGER=''
STATUS=$(aws codeconnections get-connection --region "$AWS_REGION" --connection-arn "$CONNECTION_ARN" --query 'Connection.ConnectionStatus' --output text)
[[ "$STATUS" == AVAILABLE ]] || { echo 'GitHub connection must be AVAILABLE and allow kos8123/Baglo.'; exit 1; }
get_output() { aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text; }
for TARGET_ENV in dev prod; do
  BOOTSTRAP="baglo-$TARGET_ENV-bootstrap"
  if aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$BOOTSTRAP" >/dev/null 2>&1; then
    OIDC=$(aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$BOOTSTRAP" --query "Stacks[0].Parameters[?ParameterKey=='ExistingOidcProviderArn'].ParameterValue | [0]" --output text)
    [[ "$OIDC" == None ]] && OIDC=''
  else
    OIDC=$(aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[?contains(Arn, `token.actions.githubusercontent.com`)].Arn | [0]' --output text)
    [[ "$OIDC" == None ]] && OIDC=''
  fi
  aws cloudformation deploy --region "$AWS_REGION" --stack-name "$BOOTSTRAP" --template-file infra/bootstrap.yaml --capabilities CAPABILITY_IAM --parameter-overrides "Environment=$TARGET_ENV" "Repository=kos8123/Baglo" "ExistingOidcProviderArn=$OIDC" --no-fail-on-empty-changeset
  ROLE=$(get_output "$BOOTSTRAP" DeployRoleArn)
  CFN=$(get_output "$BOOTSTRAP" CloudFormationRoleArn)
  BUCKET=$(get_output "$BOOTSTRAP" ArtifactBucket)
  aws cloudformation deploy --region "$AWS_REGION" --stack-name "baglo-$TARGET_ENV-pipeline" --template-file infra/codepipeline.yaml --capabilities CAPABILITY_IAM --parameter-overrides "Environment=$TARGET_ENV" "ConnectionArn=$CONNECTION_ARN" "ArtifactBucket=$BUCKET" "DeployRoleArn=$ROLE" "CloudFormationRoleArn=$CFN" "FugleSecretArn=${BAGLO_FUGLE_SECRET_ARN:-}" "OpenAISecretArn=${BAGLO_OPENAI_SECRET_ARN:-}" "OpenAIModel=${BAGLO_OPENAI_MODEL:-gpt-4.1-mini}" "AiAccounts=${BAGLO_AI_ACCOUNTS:-}" "AiSchedule=${BAGLO_AI_SCHEDULE:-DISABLED}" --no-fail-on-empty-changeset
  get_output "baglo-$TARGET_ENV-pipeline" ConsoleUrl
done
