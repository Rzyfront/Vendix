---
name: vendix-cloud-operations
description: >
  Vendix cloud operations with the private production runbook, SSH and AWS CLI. Trigger: consulting
  keys/README.md, AWS CLI cloud inventory, locating production resources, choosing SSH vs AWS CLI.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Cloud Operations

Cloud inventory, resource orientation and tool choice. EC2 incidents, deploys (blue/green), disk
pressure and Docker cleanup → `vendix-ec2-maintenance`.

## Rules

- `keys/README.md` is the private runbook (gitignored; present in the main checkout, not in worktrees).
  Never copy it into committed files.
- No secret values in skills, AGENTS, tickets, PRs or chat. Secrets Manager: names only (list/describe).
- Discover with AWS CLI before hardcoding IPs, distribution IDs, buckets or endpoints; values that drift
  are resolved live and reported with when they were verified.
- SSH only for host-local state (containers, Nginx, disk, logs, ports, localhost health), after AWS
  identified the host.
- Read-first. Any production write: state target, command, expected effect and rollback, and ask first.

## Source map

| Need | Source |
| --- | --- |
| Backend deploy | `.github/workflows/deploy-backend-ec2.yml` (GitHub Actions → ECR `vendix-backend` → EC2) |
| Frontend deploy | `.github/workflows/deploy-s3.yml` (S3 + CloudFront) |
| EC2 id / public IP | `aws ec2 describe-instances` |
| DNS: EC2 or CloudFront? | Route53 + `dig` |
| CloudFront aliases, origins, status | `aws cloudfront list-distributions` / `get-distribution` |
| Buckets | `aws s3api …` |
| Image tags | `aws ecr describe-images` |
| DB metadata | `aws rds describe-db-instances` |
| Secret names | `aws secretsmanager list-secrets` (prefix `vendix/production`) |
| Email identities | `aws ses …` |
| Metrics / log groups | `aws cloudwatch`, `aws logs describe-log-groups` |
| Containers, Nginx, disk, local health | SSH: `docker ps`, `docker logs`, `systemctl`, `ss`, `nginx -T`, `curl 127.0.0.1:<slot>` |

Query patterns: `references/aws-cli-patterns.md` (leer bajo demanda).

## Production host facts

Two API slots `vendix-backend-blue` (`127.0.0.1:3001`) / `vendix-backend-green` (`127.0.0.1:3002`),
one active, plus `vendix-backend-worker`; host port 3000 is no longer published (`localhost:3000`
examples are DEV only). Resolve the active slot and port from `/etc/nginx/conf.d/vendix-upstream.conf`
— commands in `vendix-ec2-maintenance`.

## Updating the private runbook

Replace stale facts with "resolve with AWS CLI" commands, add a "last verified" timestamp and how it was
verified (AWS CLI, SSH, DNS, HTTP), keep secrets out, keep it copy-paste friendly.
