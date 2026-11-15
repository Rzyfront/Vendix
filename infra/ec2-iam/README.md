# EC2 sin llaves IAM estáticas (QUI-586)

## Qué cambia

El deploy del backend (`.github/workflows/deploy-backend-ec2.yml`) ya no escribe las llaves del usuario IAM `github-actions-s3-deploy` en `~ec2-user/.aws/credentials`. En el host:

1. Borra cualquier `~/.aws/credentials` que haya quedado de deploys anteriores.
2. Comprueba con `aws sts get-caller-identity` que la identidad es el **instance role** (`…:assumed-role/vendix-ec2-production-role/i-…`). Si no, aborta.
3. Hace `docker login` en ECR con el rol (IMDS). Si falla, aborta con un mensaje que apunta a este runbook.

Los tres pasos corren **antes** de limpiar Docker y de hacer pull: si algo falla, los contenedores en servicio no se tocan.

El rol necesita permiso de **pull** en ECR, que hoy no tiene. La política mínima está en `ecr-pull-policy.json` (solo `GetAuthorizationToken` + lectura de capas/imágenes del repo `vendix-backend`; sin push).

## Orden de ejecución (manual, requiere AWS; cada escritura en prod se confirma antes)

> **No mergear a `main` antes del paso 2.** Sin el permiso de ECR el deploy aborta (sin downtime, pero sin desplegar).

1. **Crear y adjuntar la política al rol**

   ```bash
   aws iam create-policy --policy-name vendix-ec2-ecr-pull-access \
     --policy-document file://infra/ec2-iam/ecr-pull-policy.json
   aws iam attach-role-policy --role-name vendix-ec2-production-role \
     --policy-arn arn:aws:iam::637423209959:policy/vendix-ec2-ecr-pull-access
   ```

   Rollback: `aws iam detach-role-policy` con el mismo ARN.

2. **Probar el rol en el host sin borrar nada todavía**

   ```bash
   crontab -l; sudo crontab -l          # anotar scripts que usen la CLI de AWS: pasarán a usar el rol
   mv ~/.aws/credentials ~/.aws/credentials.bak
   aws sts get-caller-identity          # debe ser …:assumed-role/vendix-ec2-production-role/i-…
   aws ecr get-login-password --region us-east-1 | sudo docker login \
     --username AWS --password-stdin 637423209959.dkr.ecr.us-east-1.amazonaws.com
   aws secretsmanager describe-secret --secret-id vendix/production/app --query Name
   ```

   Rollback: `mv ~/.aws/credentials.bak ~/.aws/credentials`.

3. **Mergear y desplegar.** En el log del step "Deploy to EC2 instance" debe verse `✅ AWS identity: …assumed-role/vendix-ec2-production-role/…` y `Login Succeeded`, y el deploy terminar verde.

4. **Borrar el respaldo de las llaves en el host:** `rm -f ~/.aws/credentials.bak && aws sts get-caller-identity`.

5. **Rotar la llave del usuario de GitHub Actions** (estuvo en disco en una caja con SSH abierto):

   ```bash
   aws iam create-access-key --user-name github-actions-s3-deploy   # guardar en GitHub Secrets (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
   aws iam update-access-key --user-name github-actions-s3-deploy \
     --access-key-id AKIAZI2LCJXTUFVXT6QI --status Inactive
   # tras un deploy backend y uno frontend verdes con la llave nueva:
   aws iam delete-access-key --user-name github-actions-s3-deploy --access-key-id AKIAZI2LCJXTUFVXT6QI
   ```

   Rollback antes del `delete`: `--status Active` sobre la llave vieja.

## Criterio de éxito

- `~/.aws/credentials` no existe en la instancia.
- `aws sts get-caller-identity` en la instancia devuelve el ARN del rol.
- El deploy completa verde sin `aws configure set aws_access_key_id`.
- La llave `AKIAZI2LCJXTUFVXT6QI` está eliminada.
- El rol solo tiene pull de ECR (no push).

## Test local

`node infra/ec2-iam/ec2-iam.test.cjs` (sin AWS) fija que el workflow no escribe llaves en el host, que el step de deploy no recibe las llaves, el orden borrar credenciales → verificar rol → login ECR → limpieza/pull, y que la política solo concede pull sobre `vendix-backend`.

## Seguimiento

Migrar GitHub Actions a OIDC (`aws-actions/configure-aws-credentials` con `role-to-assume`) y eliminar el usuario IAM `github-actions-s3-deploy`, para no dejar llaves de larga vida tampoco en GitHub Secrets.
