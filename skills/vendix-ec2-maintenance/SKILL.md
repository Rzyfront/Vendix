---
name: vendix-ec2-maintenance
description: >
  Vendix EC2 production maintenance and troubleshooting: GitHub Actions to ECR + EC2 deploy,
  targeted Docker cleanup, CloudWatch/monitoring-first diagnosis, and safe SSH/AWS access
  expectations. Trigger: When dealing with EC2 deployment failures, disk pressure, Docker
  pull/layer errors, or server cleanup.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "EC2 maintenance, deployment disk issues, or Docker layer/pull failures"
---

# Vendix EC2 Maintenance

## Source of Truth

- `.github/workflows/deploy-backend-ec2.yml`
- `.github/workflows/deploy-s3.yml`
- backend monitoring services under `apps/backend/src/domains/superadmin/monitoring/`
- `docker-compose.yml`

## Production Reality

- Backend is built in GitHub Actions, pushed to ECR, and deployed on EC2.
- Frontend is deployed separately to S3/CloudFront, not through the EC2 backend workflow.
- Deploy workflow fetches secrets from AWS Secrets Manager.

## Access Expectations

- Do not hard-require a user-provided local `.pem` path in the skill text.
- For this repo, automation commonly uses GitHub secret `VENDIX_SSH_PRIVATE_KEY` and resolves host/instance data through AWS.
- If manual access is needed, confirm the approved access method first: AWS CLI, SSM/SSH, bastion, or a provided key.

## Diagnosis Order

Prefer evidence in this order:

1. GitHub Actions deploy logs.
2. Superadmin infrastructure/monitoring views backed by CloudWatch.
3. AWS CLI inspection if available.
4. SSH only when server-level state is needed.

## Disk / Docker Cleanup

Avoid blanket `docker system prune -a -f` as the default advice.

Prefer the repo’s targeted cleanup sequence when disk pressure or layer registration failures appear:

- container prune
- image prune
- volume prune
- builder prune
- package/cache cleanup as used in deploy automation

Be careful with persistent infra components such as shared Docker network/Redis state.

## Common Symptoms

- `no space left on device`
- Docker layer registration or pull failures
- stale images/containers consuming disk during deploy

`npm install` failure is not a primary EC2 deploy symptom for this repo because production backend images are built before reaching the instance.

## Live Infra Note

AWS CLI checks such as `aws sts get-caller-identity` are safe for validating access context. Use live infra reads only when repository evidence is insufficient.

## Related Skills

- `vendix-cloud-operations` - General AWS CLI, SSH, and private production runbook orientation.
- `vendix-monorepo-workspaces`
- `buildcheck-dev`
- `git-workflow`
