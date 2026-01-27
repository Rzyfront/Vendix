# Vendix EC2 Maintenance & Troubleshooting

## Description

Guidelines for troubleshooting and maintaining EC2 instances, specifically for deployment failures related to disk space or Docker issues.

## Trigger

- "no space left on device" error in deployment logs.
- "failed to register layer" error in Docker build/pull.
- Deployment hangs or fails mysteriously on EC2.
- User asks to check or clean the server.

## Protocols

### 1. 🛑 Security First

- **NEVER** assume the location or name of the SSH private key (`.pem`).
- **ALWAYS** ask the user to provide the path to the SSH key for the specific environment (dev/prod).
- **DO NOT** search for keys in `.ssh/` automatically unless explicitly instructed by the user in the current session.
- Example: _"Para proceder, necesito que me indiques la ruta de la llave .pem para conectarme al servidor."_

### 2. 🔍 Diagnosis

Connect to the server and check disk usage:

```bash
ssh -i <USER_PROVIDED_KEY> ec2-user@<SERVER_IP> "df -h && docker system df"
```

### 3. 🧹 Cleanup (Disk Space)

If disk usage is high (>85%) or Docker cache is large:

**Prune Unused Docker Objects:**

```bash
docker system prune -a -f
```

_Note: This removes all stopped containers and unused images. It is usually safe for CI/CD servers that pull fresh images on deploy._

**Check Specific Volumes:**
If `docker prune` isn't enough, check for large log files or orphan volumes:

```bash
du -sh /var/log/*
docker volume ls
```

### 4. 🔄 Common Issues

- **Docker Layer Registration Failed:** Indicates disk full. Run cleanup immediately.
- **npm install fails:** May indicate OOM (Out of Memory) or disk full. Check `free -m` and `df -h`.
