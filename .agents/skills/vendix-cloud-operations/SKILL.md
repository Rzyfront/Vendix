---
name: vendix-cloud-operations
description: >
  Vendix cloud operations guidance for using the private production runbook,
  SSH, and AWS CLI to inspect or administer cloud resources. Trigger: When
  consulting keys/README.md, using AWS CLI for Vendix cloud inventory, checking
  production resource locations, or deciding whether to use SSH versus AWS CLI.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Using AWS CLI to inspect or administer Vendix cloud resources"
    - "Using SSH to inspect Vendix production infrastructure"
    - "Consulting or updating keys/README.md production runbook"
    - "Checking production resource locations, IPs, distributions, buckets, ECR, RDS, Route53, or Secrets Manager metadata"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Cloud Operations

## Purpose

Use this skill when an agent needs to operate or inspect Vendix production cloud resources through the private runbook, AWS CLI, or SSH.

This skill does not replace `vendix-ec2-maintenance`. Use this skill for cloud inventory, resource orientation, and choosing the right operational tool. Use `vendix-ec2-maintenance` for EC2 incidents, deploy failures, disk pressure, Docker cleanup, or server-level troubleshooting.

## Core Rules

- Treat `keys/README.md` as the private operational runbook when it exists locally.
- Do not copy private runbook snapshots into committed files.
- Do not store secret values in skills, AGENTS files, tickets, PRs, or chat responses.
- Prefer AWS CLI for resource discovery before hardcoding IPs, distribution IDs, bucket names, or endpoints.
- Prefer SSH only for host-local state: Docker containers, Nginx, disk, logs, ports, and local health checks.
- If a value can drift, resolve it live with AWS CLI and state when it was verified.
- Keep cloud operations read-first. Ask before making production changes.

## Source Map

| Need | Primary Source |
| --- | --- |
| Current private operational snapshot | `keys/README.md` |
| Backend deploy behavior | `.github/workflows/deploy-backend-ec2.yml` |
| Frontend deploy behavior | `.github/workflows/deploy-s3.yml` |
| EC2 instance metadata and public IP | `aws ec2 describe-instances` |
| DNS records | `aws route53 list-resource-record-sets` |
| CloudFront aliases and origins | `aws cloudfront list-distributions` / `get-distribution` |
| Frontend and asset buckets | `aws s3api list-buckets`, `get-bucket-website`, `get-bucket-location` |
| Backend image repository and tags | `aws ecr describe-repositories`, `describe-images` |
| Database metadata | `aws rds describe-db-instances` |
| Secret inventory by name only | `aws secretsmanager list-secrets` |
| Email identity metadata | `aws ses list-identities`, `get-identity-verification-attributes` |
| Cloud metrics and log groups | `aws cloudwatch`, `aws logs describe-log-groups` |
| Runtime host state | SSH + `systemctl`, `ss`, `nginx -T`, `docker`, `curl localhost` |

## Tool Selection

| Situation | Use |
| --- | --- |
| Need the current EC2 public IP | AWS CLI EC2 query |
| Need to know whether DNS points to EC2 or CloudFront | Route53 + `dig` |
| Need CloudFront distribution, aliases, origins, or deploy status | AWS CLI CloudFront |
| Need frontend deploy target | Workflow + S3/CloudFront AWS CLI |
| Need backend deploy target or current image tags | Workflow + ECR AWS CLI |
| Need DB engine/version/public exposure metadata | AWS CLI RDS |
| Need names of production secrets | AWS CLI Secrets Manager list operation |
| Need cloud metrics or log group inventory | AWS CLI CloudWatch / Logs |
| Need container status, logs, disk, Nginx, or localhost health | SSH to EC2 |
| Need EC2 deploy failure diagnosis or cleanup | `vendix-ec2-maintenance` |

## Standard Workflow

1. Read the relevant source map entry before acting.
2. If `keys/README.md` exists, use it for the latest local runbook and verified command patterns.
3. Use AWS CLI to confirm cloud resource identity and current location.
4. Use SSH only after cloud-level discovery shows the target host.
5. For any production write/change, summarize target, command, expected effect, and rollback path before running it.
6. After updating the private runbook, verify it avoids secret values and stale hardcoded facts.

## AWS CLI Patterns

Use focused queries and projected output so responses stay safe and readable:

```bash
aws ec2 describe-instances \
  --region us-east-1 \
  --filters Name=instance-state-name,Values=running,stopped \
  --query 'Reservations[].Instances[].{InstanceId:InstanceId,Name:Tags[?Key==`Name`]|[0].Value,State:State.Name,PublicIp:PublicIpAddress,InstanceType:InstanceType,KeyName:KeyName}' \
  --output table
```

```bash
aws cloudfront list-distributions \
  --query 'DistributionList.Items[].{Id:Id,DomainName:DomainName,Status:Status,Enabled:Enabled,Aliases:Aliases.Items}' \
  --output table
```

```bash
aws ecr describe-images \
  --region us-east-1 \
  --repository-name vendix-backend \
  --query 'sort_by(imageDetails,& imagePushedAt)[-5:].{tags:imageTags,pushed:imagePushedAt,digest:imageDigest}' \
  --output json
```

```bash
aws secretsmanager list-secrets \
  --region us-east-1 \
  --filters Key=name,Values=vendix/production \
  --query 'SecretList[].{Name:Name,LastChangedDate:LastChangedDate,Description:Description}' \
  --output table
```

```bash
aws logs describe-log-groups \
  --region us-east-1 \
  --query 'logGroups[].{Name:logGroupName,Retention:retentionInDays,StoredBytes:storedBytes}' \
  --output table
```

For this skill, use Secrets Manager list/describe style operations only. Do not include commands that print stored secret payloads in cloud inventory or runbook guidance.

## SSH Patterns

Resolve the target host from AWS before connecting. Use SSH for local runtime facts:

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
sudo docker logs vendix-backend --tail 100
sudo systemctl is-active nginx
sudo ss -tulpn | grep -E ':(80|443|3000|6379)'
curl -fsS http://localhost:3000/api/health
```

Do not make SSH the first discovery step when AWS CLI can identify the resource directly.

## Runbook Updates

When updating `keys/README.md`:

- Replace stale facts with "resolve with AWS CLI" commands where possible.
- Include a "last verified" timestamp for snapshots.
- Keep actual secret values out.
- Mention whether a value was verified by AWS CLI, SSH, DNS, or HTTP.
- Keep the runbook operational and copy-paste friendly.

## Related Skills

- `vendix-ec2-maintenance` - EC2 incidents, deployment failures, disk pressure, and Docker cleanup.
- `git-workflow` - Branching, commits, and PR rules.
- `skill-sync` - Required after creating or changing skills.
