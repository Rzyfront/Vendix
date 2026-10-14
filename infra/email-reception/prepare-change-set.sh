#!/usr/bin/env bash
# Future operator action only: creates a NON-EXECUTED CloudFormation change set.
# Never activates a SES rule set, publishes DNS or enables the backend pilot.
set -euo pipefail
if [[ "${1:-}" != '--approved-inventory' || $# -ne 1 ]]; then
  echo 'Usage: populate reviewed env values, then prepare-change-set.sh --approved-inventory' >&2
  echo 'This calls AWS only after authorized inventory/ruleset review; no execution follows.' >&2
  exit 2
fi
: "${AWS_PROFILE:?Select authorized AWS profile}"
: "${ENVIRONMENT:?production or staging}"
: "${STACK_NAME:?Choose new stack name}"
: "${RECEIPT_RULE_SET_NAME:?Existing reviewed rule set name}"
: "${BACKEND_PRINCIPAL_ARN:?Existing backend identity}"
: "${OPERATOR_PRINCIPAL_ARN:?Separate existing operator identity}"
: "${ORIGINAL_OBJECT_ARN:?Existing fiscal received-documents object namespace}"
: "${OPERATIONS_EMAIL:?Accountable operations mailbox}"
[[ "$ENVIRONMENT" == production || "$ENVIRONMENT" == staging ]] || { echo 'Invalid environment' >&2; exit 2; }
[[ "$BACKEND_PRINCIPAL_ARN" != "$OPERATOR_PRINCIPAL_ARN" ]] || { echo 'Backend and redrive operator must differ' >&2; exit 2; }
[[ "$STACK_NAME" =~ ^[A-Za-z][A-Za-z0-9-]{0,127}$ ]] || { echo 'Invalid stack name' >&2; exit 2; }
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
# --no-execute-changeset is mandatory. No set-active-receipt-rule-set or DNS calls.
aws cloudformation deploy \
  --profile "$AWS_PROFILE" --region us-east-1 \
  --stack-name "$STACK_NAME" \
  --template-file "$ROOT/infra/email-reception/receipt-rules.yaml" \
  --capabilities CAPABILITY_IAM --no-execute-changeset \
  --parameter-overrides \
    Environment="$ENVIRONMENT" ResourcePrefix="${RESOURCE_PREFIX:-vendix-email}" \
    ReceiptRuleSetName="$RECEIPT_RULE_SET_NAME" ReceiptRuleEnabled=false \
    AfterReceiptRuleName="${AFTER_RECEIPT_RULE_NAME:-}" \
    BackendPrincipalArn="$BACKEND_PRINCIPAL_ARN" OperatorPrincipalArn="$OPERATOR_PRINCIPAL_ARN" \
    OriginalObjectArn="$ORIGINAL_OBJECT_ARN" OperationsEmail="$OPERATIONS_EMAIL" \
    MonthlyBudgetUsd="${MONTHLY_BUDGET_USD:-25}"
echo 'Change set prepared, NOT executed. Review resource changes/IAM/region before separate authorized execution.'
