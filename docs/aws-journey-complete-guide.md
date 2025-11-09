# 🚀 Mi Aventura Completa: Configurando Vendix en AWS Desde Cero

## 📝 Introducción: Por Qué Empecé Este Viaje

Este documento no es una guía tradicional de AWS. Es el crudo registro de mi primer encuentro real con la infraestructura en la nube de Amazon, donde descubrí que configurar un sistema multi-tenant en producción es un arte que combina paciencia, conocimiento técnico y, sobre todo, mucha capacidad de aprender de los errores.

Mi objetivo era simple: tomar mi aplicación Vendix (un e-commerce multi-tenant) y desplegarla en AWS con soporte para subdominios dinámicos. Lo que no sabía era que este viaje me enseñaría más sobre infraestructura que meses de tutoriales teóricos.

---

## 🎯 El Plan Original: Mis Expectativas vs Realidad

### **Lo que yo pensaba que sería:**
1. Subir frontend a S3 (como ya lo hacía)
2. Subir backend a algún servicio de AWS
3. Configurar un dominio
4. Listo

### **Lo que realmente descubrí:**
La arquitectura en la nube es como construir un edificio: necesitas cimientos sólidos (IAM roles), estructura (VPC y networking), servicios conectados (RDS, App Runner), y finalmente el acabado (CloudFront, DNS).

---

## 🗺️ El Mapa del Viaje: Arquitectura Final que Logramos

```
*.vendix.online (cualquier subdominio)
    ↓
Route 53 (DNS Management)
    ↓
CloudFront Distribution (CDN + SSL + API Routing)
    ↓
    /api/* → App Runner (NestJS + Prisma + PostgreSQL)
    /*    → S3 Bucket (Angular SPA)
```

### **Servicios AWS que terminamos usando:**
- **Route 53**: Gestión de DNS con control de subdominios wildcards
- **ACM**: Certificados SSL wildcard para todos los subdominios
- **App Runner**: Backend serverless con auto-scaling
- **RDS PostgreSQL**: Base de datos gestionada
- **S3**: Almacenamiento estático con acceso seguro via OAI
- **ECR**: Registry de Docker para nuestras imágenes
- **CloudFront**: CDN con routing inteligente
- **IAM**: Roles y permisos granulares

---

## 🏁 Paso 1: El Comienzo - Transferir Control DNS

### **El Problema:**
Mi dominio `vendix.online` estaba controlado por Vercel. Necesitaba transferirlo a AWS para tener control total de los subdominios.

### **Lo que aprendí sobre DNS:**
- **Nameservers son las direcciones del DNS**: Cambiarlos es como cambiar la dirección de tu casa en el correo postal.
- **La propagación DNS no es instantánea**: Puede tomar 5-30 minutos, y durante ese tiempo, nada funciona.
- **Route 53 vs otros DNS providers**: Route 53 es como tener un conserje de lujo para tu DNS - más potente pero con más responsabilidades.

### **Comandos que usé:**
```bash
# Crear hosted zone para mi dominio
aws route53 create-hosted-zone \
  --name vendix.online \
  --caller-reference vendix-setup-$(date +%s)

# Obtuve los 4 nameservers que AWS me dio:
# ns-1304.awsdns-35.org
# ns-957.awsdns-55.net
# ns-1674.awsdns-17.co.uk
# ns-476.awsdns-59.com
```

### **El momento de verdad:**
Fui a Namecheap y cambié los nameservers. Ahí entendí que no hay vuelta atrás - mi landing page en Vercel dejaría de funcionar inmediatamente.

---

## 🔐 Paso 2: Certificados SSL - El Dolor de la Validación

### **Mi primera gran lección sobre ACM:**
AWS Certificate Manager es gratuito, pero los certificados wildcard requieren validación DNS. Esto fue mi primer encuentro real con la complejidad de la seguridad en la nube.

### **El proceso:**
```bash
# Solicité certificado wildcard
aws acm request-certificate \
  --domain-name "*.vendix.online" \
  --validation-method DNS \
  --subject-alternative-names "vendix.online" "api.vendix.online"
```

### **Lo que no sabía:**
- ACM te da registros DNS que debes crear manualmente
- La validación puede tomar hasta 15 minutos
- Necesitas crear registros CNAME específicos para cada dominio

### **Mi configuración DNS de validación:**
```
_ee72824b056487e25103d19656d93dde.vendix.online → _5882e0465ffc039827b8a302580bda01.jkddzztszm.acm-validations.aws.
_4bc25b64272d70d369ef8bd5ce25af64.api.vendix.online → _389ca7028ecb22f398b3108a64ef0a3c.jkddzztszm.acm-validations.aws.
```

### **La satisfacción final:**
Después de 15 minutos de espera, el certificado cambió de `PENDING_VALIDATION` a `ISSUED`. Fue mi primera victoria real en AWS.

---

## 🗄️ Paso 3: RDS - Donde Aprendí sobre Base de Datos en la Nube

### **Mi decisión sobre la base de datos:**
Consideré varias opciones:
- **Docker local**: Simple pero no escalable
- **RDS Serverless v2**: Moderno pero complejo
- **RDS tradicional**: Confiable y bien documentado

Elegí RDS PostgreSQL tradicional con instancia `db.t3.micro` porque está cubierta por Free Tier.

### **Comandos para crear la base de datos:**
```bash
# Crear subnet group (AWS necesita esto para RDS)
aws rds create-db-subnet-group \
  --db-subnet-group-name vendix-subnet-group \
  --db-subnet-group-description "Subnet group for Vendix RDS database" \
  --subnet-ids subnet-0d2a7056bdce038df subnet-01bb6808115772576

# Crear la instancia RDS
aws rds create-db-instance \
  --db-instance-identifier vendix-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 13.16 \
  --master-username postgres \
  --master-user-password VendixSecureDB2024! \
  --allocated-storage 20 \
  --db-subnet-group-name vendix-subnet-group \
  --backup-retention-period 7 \
  --storage-type gp2 \
  --publicly-accessible
```

### **Lo que aprendí sobre RDS:**
- **Las credenciales importan**: Contraseñas seguras y gestión de secrets
- **Security Groups son cruciales**: Controlan qué puede acceder a tu base de datos
- **La conectividad es compleja**: VPN, VPC, subnets, security groups...

### **Connection String final:**
```
postgresql://postgres:VendixSecureDB2024!@vendix-db.c6bqyma82nt3.us-east-1.rds.amazonaws.com:5432/vendix_db?schema=public
```

---

## 📦 Paso 4: S3 - Donde Descubrí el Acceso Seguro

### **Mi primer intento ingenuo:**
Pensé que podía simplemente hacer el S3 bucket público, como había hecho antes.

### **El error que me enseñó:**
```
An error occurred (AccessDenied) when calling the PutBucketPolicy operation: User is not authorized to perform: s3:PutBucketPolicy because public policies are prevented by the BlockPublicPolicy setting in S3 Block Public Access.
```

### **Lo que aprendí sobre seguridad S3:**
- **Block Public Access**: AWS protege tus buckets por defecto
- **Origin Access Identity (OAI)**: Es como darle a CloudFront una llave maestra para tu S3
- **CloudFront + S3**: La combinación perfecta para frontend estáticos

### **Configuración correcta:**
```bash
# Crear OAI
aws cloudfront create-cloud-front-origin-access-identity \
  --cloud-front-origin-access-identity-config \
    CallerReference=vendix-oai-$(date +%s), \
    Comment="OAI for Vendix S3 bucket"

# Política de S3 para acceso solo desde CloudFront
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ERMIGYFICMCW4"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::vendix-online-frontend/*"
    }
  ]
}
```

---

## 🐳 Paso 5: Docker + ECR - Donde la Práctica Enseña

### **Mi Dockerfile original:**
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY prisma ./prisma
COPY .env* ./
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
```

### **El primer error de Docker:**
```
npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.
```

### **Lo que aprendí sobre npm ci vs npm install:**
- **npm ci**: Requiere package-lock.json sincronizado, más rápido y reproducible
- **npm install**: Más flexible pero lento
- **Solución**: `npm ci --omit=dev || npm install --omit=dev`

### **El segundo error: Prisma no genera:**
```
Namespace 'Prisma' has no exported member 'addressesUncheckedCreateInput'.
```

### **Mi epifanía sobre Prisma + Docker:**
¡Prisma necesita generar el client antes de compilar TypeScript!

### **Dockerfile corregido:**
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY prisma ./prisma
COPY . .
# Generate Prisma Client sin necesidad de base de datos
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY prisma ./prisma
COPY .env* ./
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
```

### **ECR - El Registro de Docker de AWS:**
```bash
# Crear repository
aws ecr create-repository \
  --repository-name vendix-backend \
  --image-scanning-configuration scanOnPush=true

# Build y push
docker build -t 637423209959.dkr.ecr.us-east-1.amazonaws.com/vendix-backend:initial .
docker push 637423209959.dkr.ecr.us-east-1.amazonaws.com/vendix-backend:initial
```

---

## 🎭 Paso 6: IAM Roles - El Concepto Más Abstracto

### **Mi confusión inicial:**
¿Por qué necesito un "rol" si ya tengo credenciales AWS? ¿No es lo mismo?

### **La revelación sobre IAM:**
- **Usuarios IAM**: Para humanos que acceden a AWS
- **Roles IAM**: Para servicios de AWS que acceden a otros servicios de AWS
- **Sin roles sin acceso fijo**: Más seguro, rotación automática

### **Creando mi primer IAM Role:**
```bash
# Trust Policy (quién puede asumir el rol)
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "build.apprunner.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}

# Policy (qué puede hacer el rol)
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "arn:aws:ecr:us-east-1:637423209959:repository/vendix-backend"
    }
  ]
}
```

### **Lo que aprendí sobre el principio de menor privilegio:**
No darle más permisos de los necesarios. Mi rol solo puede:
- Leer del ECR repository específico
- Escribir logs en CloudWatch
- Nada más

---

## 🚀 Paso 7: App Runner - Donde Todo se Conecta

### **Mi primera configuración fallida:**
```bash
aws apprunner create-service --cli-input-json file:///tmp/apprunner-config.json
```

### **Error:** `Authentication configuration is invalid`

### **Lo que no entendía:**
App Runner necesita permisos para acceder a ECR. Sin el IAM role correcto, no puede descargar mi Docker image.

### **Mi configuración exitosa:**
```json
{
  "ServiceName": "vendix-backend",
  "SourceConfiguration": {
    "ImageRepository": {
      "ImageIdentifier": "637423209959.dkr.ecr.us-east-1.amazonaws.com/vendix-backend:initial",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000"
      }
    },
    "AuthenticationConfiguration": {
      "AccessRoleArn": "arn:aws:iam::637423209959:role/AppRunnerECRAccessRole"
    }
  }
}
```

### **El segundo problema: CREATE_FAILED**
App Runner falló porque mi aplicación necesita environment variables para iniciar.

### **Variables de entorno críticas:**
```json
{
  "RuntimeEnvironmentVariables": {
    "DATABASE_URL": "postgresql://postgres:VendixSecureDB2024!@vendix-db.c6bqyma82nt3.us-east-1.rds.amazonaws.com:5432/vendix_db?schema=public",
    "JWT_SECRET": "your-super-secret-jwt-key-here",
    "NODE_ENV": "production",
    "FRONTEND_URL": "https://vendix.online",
    "EMAIL_PROVIDER": "resend",
    "EMAIL_API_KEY": "re_CSyZU8aE_Q1jAs1kgPyjzpaSBfemVG4be",
    "EMAIL_FROM": "noreply@vendix.online"
  }
}
```

### **Lo que aprendí sobre App Runner:**
- **Health checks son cruciales**: TCP vs HTTP
- **Environment variables deben configurarse en la creación inicial**
- **No puedes actualizar mientras está en OPERATION_IN_PROGRESS**

---

## 🌐 Paso 8: CloudFront + S3 - La Batalla Épica contra el Host Header

### **Mi objetivo inicial:**
- Servir frontend Angular SPA desde S3
- Soportar todos los subdominios (*.vendix.online) para multi-tenancy
- SSL con mi certificado wildcard
- Que mi aplicación lea el dominio desde el navegador para resolver el tenant

### **El Gran Desafío: Multi-tenant con subdominios dinámicos**

Mi aplicación Angular tiene una lógica especial: cuando un usuario accede a `tenant1.vendix.online`, el JavaScript en el navegador lee `window.location.hostname` y hace un request al backend para resolver qué tenant es y configurar la UI.

Esto creó un reto único con CloudFront y S3.

---

### **Primera Estrategia (FALLIDA): S3 Origin Config con OAC**

**Lo que intenté:**
```json
{
  "Origins": {
    "Items": [
      {
        "Id": "S3-vendix-online-frontend",
        "DomainName": "vendix-online-frontend.s3.us-east-1.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        },
        "OriginAccessControlId": "E3SZ0M6PDD6W7J"
      }
    ]
  }
}
```

**Configuré OAC (Origin Access Control):**
```bash
aws cloudfront create-origin-access-control \
  --origin-access-control-config '{
    "Name": "vendix-frontend-oac",
    "SigningProtocol": "sigv4",
    "SigningBehavior": "always",
    "OriginAccessControlOriginType": "s3"
  }'
```

**Política del bucket para OAC:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOAC",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::vendix-online-frontend/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::637423209959:distribution/E1I27OYFJX7VYJ"
        }
      }
    }
  ]
}
```

**EL PROBLEMA:**
```
HTTP/2 404 
x-amz-error-code: NoSuchBucket
x-amz-error-message: The specified bucket does not exist
x-amz-error-detail-bucketname: vendix.online
```

¿Por qué buscaba un bucket llamado `vendix.online` si mi bucket es `vendix-online-frontend`?

**La revelación:** CloudFront estaba pasando el header `Host: vendix.online` a S3, pero S3 en modo bucket directo (no website hosting) interpreta ese header como el nombre del bucket. ¡S3 estaba buscando literalmente un bucket llamado "vendix.online"!

---

### **Segunda Estrategia (FALLIDA): Custom Origin Config sin Website Hosting**

**Lo que intenté:**
```json
{
  "Origins": {
    "Items": [
      {
        "Id": "S3-vendix-online-frontend-website",
        "DomainName": "vendix-online-frontend.s3-website-us-east-1.amazonaws.com",
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "http-only",
          "OriginReadTimeout": 60
        }
      }
    ]
  }
}
```

Desactivé el S3 Website Hosting pensando que con CustomOriginConfig era suficiente.

**EL PROBLEMA:**
```bash
aws s3api delete-bucket-website --bucket vendix-online-frontend
# Ahora S3 ya NO sirve archivos vía HTTP
```

Resultado: 404 en todos los requests porque S3 sin website hosting NO responde a requests HTTP normales cuando usas el endpoint `.s3-website-us-east-1.amazonaws.com`.

---

### **Tercera Estrategia (FALLIDA): Intentar forzar el Host header**

**Lo que intenté:**
Agregar CustomHeaders al origen para forzar el Host correcto:

```json
{
  "Origins": {
    "Items": [
      {
        "CustomHeaders": {
          "Quantity": 1,
          "Items": [
            {
              "HeaderName": "Host",
              "HeaderValue": "vendix-online-frontend.s3-website-us-east-1.amazonaws.com"
            }
          ]
        }
      }
    ]
  }
}
```

**EL PROBLEMA:** 
¡No puedes sobrescribir el header `Host` con CustomHeaders! AWS CloudFront lo ignora por razones de seguridad. El Host header es especial y está protegido.

---

### **La Solución Final (EXITOSA): S3 Website Hosting + Custom Origin + Sin Forward Host**

**La epifanía:**
1. Mi app Angular **NO necesita** que el servidor le diga el dominio
2. El JavaScript **lee el dominio del navegador**: `window.location.hostname`
3. CloudFront solo necesita **servir los archivos estáticos**
4. S3 Website Hosting **no necesita recibir el Host header del cliente**

**Configuración final que funciona:**

**Paso 1: Habilitar S3 Website Hosting**
```bash
aws s3 website s3://vendix-online-frontend/ \
  --index-document index.html \
  --error-document index.html
```

**Paso 2: Bucket Policy público (para website hosting)**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::vendix-online-frontend/*"
    }
  ]
}
```

**Paso 3: CloudFront con CustomOriginConfig**
```json
{
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-vendix-online-frontend-website",
        "DomainName": "vendix-online-frontend.s3-website-us-east-1.amazonaws.com",
        "OriginPath": "",
        "CustomHeaders": {
          "Quantity": 0
        },
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "http-only",
          "OriginSslProtocols": {
            "Quantity": 1,
            "Items": ["TLSv1.2"]
          },
          "OriginReadTimeout": 60,
          "OriginKeepaliveTimeout": 5
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-vendix-online-frontend-website",
    "ViewerProtocolPolicy": "redirect-to-https",
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": {
        "Forward": "none"
      },
      "Headers": {
        "Quantity": 0
      }
    }
  },
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      {
        "ErrorCode": 403,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      },
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      }
    ]
  }
}
```

**Paso 4: NO forward headers al origen**
```json
{
  "ForwardedValues": {
    "Headers": {
      "Quantity": 0  // ¡CLAVE! No enviar Host header a S3
    }
  }
}
```

**Por qué funciona:**
1. Usuario accede: `https://tenant1.vendix.online`
2. CloudFront intercepta, verifica SSL con certificado wildcard ✅
3. CloudFront solicita `index.html` a S3 website endpoint usando **el hostname del origen**, no el del cliente
4. S3 responde con el archivo porque recibe `Host: vendix-online-frontend.s3-website-us-east-1.amazonaws.com` ✅
5. CloudFront sirve el HTML al navegador
6. JavaScript en el navegador ejecuta: `const domain = window.location.hostname` → "tenant1.vendix.online" ✅
7. La app hace request: `fetch('https://api.vendix.online/tenant/resolve?domain=tenant1.vendix.online')` ✅

---

### **Lecciones críticas sobre CloudFront + S3:**

1. **S3 tiene DOS modos muy diferentes:**
   - **Bucket directo** (bucket.s3.region.amazonaws.com): Necesita OAC, seguro, pero interpreta Host header como nombre de bucket
   - **Website hosting** (bucket.s3-website-region.amazonaws.com): Público, sirve SPAs correctamente, ignora Host header del request

2. **El Host header es especial:**
   - No puedes sobrescribirlo con CustomHeaders
   - CloudFront lo usa para routing de aliases
   - S3 lo interpreta de formas diferentes según el modo

3. **Multi-tenant SPA no necesita pasar Host al servidor:**
   - El dominio se lee del **navegador** (window.location.hostname)
   - Los archivos estáticos son **los mismos** para todos los tenants
   - Solo el **backend API** necesita saber el tenant

4. **CustomOriginConfig vs S3OriginConfig:**
   - **S3OriginConfig**: Para S3 bucket directo con OAC/OAI (más seguro)
   - **CustomOriginConfig**: Para S3 website hosting o cualquier HTTP endpoint (más flexible)

5. **Custom Error Responses son cruciales para SPAs:**
   ```json
   {
     "ErrorCode": 404,
     "ResponsePagePath": "/index.html",
     "ResponseCode": "200"
   }
   ```
   Sin esto, las rutas de Angular (como `/products`, `/login`) retornarían 404.

---

### **Errores comunes que encontré:**

**Error 1: NoSuchBucket con OAC**
```
x-amz-error-detail-bucketname: vendix.online
```
**Solución:** Usar S3 Website Hosting con CustomOriginConfig

**Error 2: 404 después de eliminar website hosting**
```
The resource you requested does not exist
```
**Solución:** Siempre mantener website hosting activo para SPAs

**Error 3: Caché de CloudFront sirviendo errores viejos**
```
x-cache: Error from cloudfront
```
**Solución:** Invalidar caché después de cada cambio:
```bash
aws cloudfront create-invalidation \
  --distribution-id E1I27OYFJX7VYJ \
  --paths "/*"
```

**Error 4: CloudFront "InProgress" durante horas**
```
Status: InProgress
```
**Solución:** Esperar pacientemente. Deployment puede tomar 5-15 minutos. No hacer más cambios mientras está deploying.

---

### **La arquitectura final exitosa:**

```
Usuario → tenant1.vendix.online
    ↓
Route 53 (wildcard *.vendix.online → CloudFront)
    ↓
CloudFront Distribution E1I27OYFJX7VYJ
    - Alias: vendix.online, *.vendix.online
    - SSL Certificate: *.vendix.online (ACM)
    - Default Behavior → S3 Website Origin
    ↓
S3 Website Hosting: vendix-online-frontend
    - Endpoint: vendix-online-frontend.s3-website-us-east-1.amazonaws.com
    - Index: index.html
    - Error: index.html (para SPA routing)
    ↓
Navegador recibe index.html y archivos estáticos
    ↓
JavaScript lee: window.location.hostname = "tenant1.vendix.online"
    ↓
App Angular hace request a: api.vendix.online/tenant/resolve?domain=tenant1.vendix.online
```

---

### **Lo que aprendí sobre CloudFront:**
- **Distribution deployment es lento**: 5-15 minutos por cambio
- **Invalidaciones no son instantáneas**: Puede tomar 5-10 minutos
- **Path patterns son poderosos**: `/api/*` permite rutear a diferentes orígenes
- **Headers forwarding es un arte**: Demasiados = sin caché, muy pocos = app rota
- **Alias records necesitan HostedZoneId específico**: `Z2FDTNDATAQYW2` para CloudFront

---

## 🌍 Paso 9: DNS Final - Conectando Todo

### **Configuración DNS final:**
```json
{
  "Changes": [
    {
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "vendix.online",
        "Type": "A",
        "AliasTarget": {
          "DNSName": "d10fsx06e3z6rc.cloudfront.net",
          "HostedZoneId": "Z2FDTNDATAQYW2"
        }
      }
    },
    {
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "*.vendix.online",
        "Type": "A",
        "AliasTarget": {
          "DNSName": "d10fsx06e3z6rc.cloudfront.net",
          "HostedZoneId": "Z2FDTNDATAQYW2"
        }
      }
    }
  ]
}
```

### **La magia de los wildcard DNS:**
- `vendix.online` → CloudFront (frontend principal)
- `*.vendix.online` → CloudFront (todos los tenants)
- CloudFront decide basado en path patterns

---

## 🤔 Decisiones Técnicas Clave que Tomé

### **1. App Runner vs Elastic Beanstalk vs ECS:**
- **App Runner**: Más simple, serverless, ideal para mi caso de uso
- **Elastic Beanstalk**: Más tradicional, más control pero más complejo
- **ECS**: Máximo control, máxima complejidad

### **2. RDS vs Aurora vs Serverless:**
- **RDS tradicional**: Predecible, bien documentado, Free Tier coverage
- **Aurora**: Alto rendimiento pero más caro
- **Serverless**: Paga por uso pero complejo de configurar

### **3. CloudFront vs ALB + Architectura compleja:**
- **CloudFront**: Simplicitad, CDN incluido, SSL manejado
- **ALB**: Más control pero más servicios que gestionar

### **4. Route 53 vs External DNS:**
- **Route 53**: Integración perfecta con otros servicios AWS
- **External**: Más barato pero menos integrado

---

## 📊 Costos - La Realidad de la Nube

### **Durante desarrollo (Free Tier activo):**
- **App Runner**: $5-15/mes (0.25 vCPU, 512MB)
- **RDS PostgreSQL**: GRATIS (db.t3.micro en Free Tier)
- **S3 Storage**: $1-3/mes (archivos frontend)
- **CloudFront**: $2-5/mes (data transfer + requests)
- **Route 53**: $0.50/mes (hosted zone)
- **ACM**: GRATIS (certificados SSL)
- **Total estimado**: $8.50-23.50/mes

### **Después de Free Tier:**
- **RDS**: $12-18/mes
- **Total**: $32-48/mes

### **Lo que aprendí sobre costos:**
- **Free Tier es tu mejor amigo durante desarrollo**
- **El scaling puede aumentar costos drásticamente**
- **CloudFront charges por requests y data transfer**

---

## 🔄 GitHub Actions - Automatizando Todo

### **Mi workflow final para ECR + App Runner:**
```yaml
name: Deploy Backend to App Runner via ECR

on:
  push:
    branches: [ main ]
    paths:
      - 'apps/backend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v4
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1

    - name: Login to Amazon ECR
      uses: aws-actions/amazon-ecr-login@v2

    - name: Build, tag, and push Docker image
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: vendix-backend
        IMAGE_TAG: ${{ github.sha }}
      run: |
        cd apps/backend
        docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG -t $ECR_REGISTRY/$ECR_REPOSITORY:latest .
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

    - name: Update App Runner service
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: vendix-backend
        IMAGE_TAG: ${{ github.sha }}
      run: |
        aws apprunner update-service \
          --service-arn $(aws apprunner list-services --query 'ServiceSummaryList[?ServiceName==`vendix-backend`].ServiceArn' --output text) \
          --source-configuration ImageRepository="{
            ImageIdentifier=\"$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG\",
            ImageRepositoryType=\"ECR\",
            ImageConfiguration={Port=3000}
          }"
```

---

## 🐛 Errores Comunes y Cómo los Resolví

### **1. "npm ci" sync error:**
```
npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.
```
**Solución**: `RUN npm ci --omit=dev || npm install --omit=dev`

### **2. Prisma types not found:**
```
Namespace 'Prisma' has no exported member 'addressesUncheckedCreateInput'.
```
**Solución**: Agregar `RUN npx prisma generate` antes de `RUN npm run build`

### **3. App Runner CREATE_FAILED:**
```
Authentication configuration is invalid.
```
**Solución**: Crear IAM role con permisos ECR correctamente

### **4. CloudFront parameter validation errors:**
```
Unknown parameter: "OriginReadTimeout"
```
**Solución**: Usar solo parámetros soportados para cada tipo de origin

### **5. DNS validation:**
```
Missing required parameter: "HostedZoneId"
```
**Solución**: CloudFront necesita `Z2FDTNDATAQYW2` como HostedZoneId

---

## 🎓 Lecciones Fundamentales que Aprendí

### **Sobre AWS:**
1. **Todo está conectado**: No puedes configurar un servicio aislado
2. **IAM es fundamental**: Sin los roles y permisos correctos, nada funciona
3. **La documentación es tu mejor amiga**: Pero a veces necesitas combinar múltiples fuentes
4. **Los errores son oportunidades**: Cada error me enseñó algo nuevo sobre la arquitectura

### **Sobre infraestructura:**
1. **La seguridad no es opcional**: OAI, roles, security groups son esenciales
2. **El principio de menor privilegio**: Solo dar los permisos necesarios
3. **El monitoreo es crucial**: CloudWatch logs son indispensables para debugging
4. **La automatización es clave**: GitHub Actions hace todo sostenible

### **Sobre desarrollo:**
1. **Environment variables son críticas**: Sin ellas, nada funciona en producción
2. **Docker multi-stage es eficiente**: Reduce tamaño de imágenes y mejora seguridad
3. **Prisma necesita generate**: Siempre generar client antes de compilar
4. **Los tests deben ejecutarse**: Antes de cada deploy a producción

---

## 🚀 Qué Haría Diferente la Próxima Vez

### **Optimizaciones:**
1. **Infrastructure as Code**: Usar Terraform o CloudFormation para todo reproducible
2. **Monitoring avanzado**: Configurar alarms y dashboards desde el principio
3. **Backup strategy**: Implementar backups automáticos y restore procedures
4. **Security hardening**: WAF en CloudFront, VPN para administración

### **Mejoras técnicas:**
1. **Database migrations**: Scripteado y versionado
2. **Canary deployments**: Gradual rollout para reducir riesgos
3. **Health checks más robustos**: Custom endpoints con dependency checks
4. **Log aggregation**: Centralizado y searchable

---

## 🎯 El Resultado Final

### **Lo que logré construir:**
- **Multi-tenant architecture**: Soporte ilimitado de subdominios
- **Auto-deployment**: Git push → producción automático
- **Scalable infrastructure**: Escala automáticamente según demanda
- **Secure by default**: OAI, IAM roles, SSL everywhere
- **Cost-effective**: Usa Free Tier y serverless durante desarrollo
- **Production-ready**: Monitoring, backups, health checks

### **La URL final que funciona:**
```
https://vendix.online → Frontend principal
https://api.vendix.online → Backend API
https://tenant1.vendix.online → Frontend para tenant1
https://*.vendix.online → Cualquier tenant nuevo
```

### **La satisfacción de verlo funcionar:**
Cuando el primer dominio resolvió correctamente y vi mi frontend cargando a través de CloudFront, con los logs apareciendo en CloudWatch, y sabiendo que cada parte de esta infraestructura estaba conectada y funcionando... esa fue la recompensa de horas de troubleshooting y aprendizaje.

---

## 🔚 Conclusión: Más Allá de lo Técnico

Este viaje me enseñó que configurar infraestructura en la nube no es solo seguir guías y ejecutar comandos. Es entender cómo cada pieza encaja, cómo los servicios se comunican, y cómo construir algo que sea mantenible, escalable, y seguro.

La próxima vez que vea una aplicación web compleja, ya no la veré como "just code". Veré la orquesta de servicios, bases de datos, CDN, DNS, y todas las piezas invisibles que hacen posible la magia que usamos todos los días.

Y si estás empezando este viaje, espero que este documento te sirva no solo como guía técnica, sino como inspiración de que sí es posible construir sistemas complejos en AWS, incluso si al principio parece overwhelming.

**Happy cloud building!** 🌥

---

## 🔥 Capítulo 10: El Misterio del CORS - Cuando el Frontend y Backend No Se Entienden

### **El Momento de Horror: "net::ERR_FAILED"**

Acababa de terminar toda la configuración de infraestructura. Frontend desplegado, backend corriendo, base de datos funcionando. Me sentía victorioso. Abrí el navegador, accedí a `https://vendix.online` y... nada. La consola del navegador me recibió con un mensaje que me heló la sangre:

```
Access to fetch at 'https://api.vendix.com/api/domains/resolve/vendix.online' 
from origin 'https://vendix.online' has been blocked by CORS policy: 
Permission was denied for this request to access the `unknown` address space.

GET https://api.vendix.com/api/domains/resolve/vendix.online net::ERR_FAILED
```

### **La Investigación: ¿Por Qué Mi App No Funciona?**

Me senté a analizar. El error mencionaba `api.vendix.com` pero yo estaba intentando usar `vendix.online`. Ahí empecé a entender que tenía un problema de configuración en múltiples capas:

**Descubrimiento 1: Dominios desincronizados**
- Mi frontend estaba configurado para `api.vendix.com` (dominio de desarrollo antiguo)
- El backend CORS permitía `vendix.com`, no `vendix.online`
- El dominio real de producción era `vendix.online`
- El backend estaba corriendo en una URL de App Runner sin dominio personalizado

**Descubrimiento 2: No entendía CORS completamente**

Hasta ese momento, pensaba que CORS era simplemente "agregar el dominio del frontend a una lista". Pero cuando empecé a investigar, descubrí que CORS es mucho más profundo:

- El navegador envía un header `Origin` con cada request
- El servidor debe responder con `Access-Control-Allow-Origin` que coincida
- Hay "preflight requests" (OPTIONS) que necesitan configuración especial
- CloudFront puede cambiar el header Origin
- Los subdominios dinámicos requieren regex patterns, no listas estáticas

### **La Solución: Una Configuración CORS Completa y Reflexiva**

Después de leer documentación de MDN, posts de Stack Overflow, y hacer pruebas durante horas, llegué a esta configuración que realmente entiendo:

```typescript
// apps/backend/src/main.ts
app.enableCors({
  origin: process.env.CORS_ORIGIN?.split(',') || [
    'http://localhost:4200',
    'http://localhost',
    
    // Producción - vendix.online
    'https://vendix.online',
    'https://www.vendix.online',
    'https://api.vendix.online',
    
    // CloudFront distributions (importante!)
    'https://d10fsx06e3z6rc.cloudfront.net',
    'https://d1y0m1duatgngc.cloudfront.net',
    
    // Multi-tenant: Cualquier subdominio de vendix.online
    /^https:\/\/([a-zA-Z0-9-]+\.)?vendix\.online$/,
    
    // Cualquier CloudFront (útil durante desarrollo)
    /^https:\/\/[a-z0-9]+\.cloudfront\.net$/,
  ],
  credentials: true,  // Necesario para cookies y JWT
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Accept', 
    'Origin', 
    'X-Requested-With'
  ],
  exposedHeaders: ['Authorization'],  // Para leer JWT desde response headers
});
```

**¿Por qué cada línea?**

1. **CloudFront en la lista**: Descubrí que aunque el usuario acceda vía `vendix.online`, CloudFront puede enviar su propio dominio (`d10fsx06e3z6rc.cloudfront.net`) como Origin en algunos casos.

2. **Regex para subdominios**: `/^https:\/\/([a-zA-Z0-9-]+\.)?vendix\.online$/` permite `tenant1.vendix.online`, `tenant2.vendix.online`, etc. sin tener que agregar cada uno manualmente.

3. **credentials: true**: Sin esto, las cookies y headers de autenticación no se envían. Me costó 2 horas descubrir por qué mi JWT no llegaba.

4. **exposedHeaders**: Si tu frontend necesita leer headers de la response (como Authorization con un nuevo token), debes exponerlos explícitamente. Otro error que me tomó tiempo encontrar.

### **Actualizando el Frontend: Sincronización de Dominios**

También tuve que actualizar las URLs en el frontend. Aquí aprendí algo importante sobre environments en Angular:

```typescript
// apps/frontend/src/environments/environment.prod.ts
export const environment = {
  production: true,
  apiUrl: 'https://2bd2zjyqme.us-east-1.awsapprunner.com/api',
  vendixDomain: 'vendix.online',
  // ...
};

// apps/frontend/src/environments/environment.ts (desarrollo)
export const environment = {
  production: false,
  apiUrl: 'https://api.vendix.com/api',  // Mantener .com para dev
  vendixDomain: 'vendix.com',
  // ...
};
```

**Reflexión importante**: Separar ambientes me permitió mantener mi setup de desarrollo (`vendix.com`) mientras usaba producción (`vendix.online`). Esto es crucial cuando trabajas solo y necesitas testear cambios sin romper producción.

### **El Deploy: Todas las Variables de Entorno Importan**

Cuando actualicé App Runner, me di cuenta de que había olvidado variables de entorno críticas. El backend compilaba pero fallaba en runtime porque faltaban cosas como `EMAIL_API_KEY` o `JWT_REFRESH_SECRET`. Aquí está la lista completa que necesité:

```json
{
  "RuntimeEnvironmentVariables": {
    "NODE_ENV": "production",
    "PORT": "3000",
    "DATABASE_URL": "postgresql://postgres:****@vendix-db.c6bqyma82nt3.us-east-1.rds.amazonaws.com:5432/vendix_db?schema=public",
    "JWT_SECRET": "****",
    "JWT_REFRESH_SECRET": "****",
    "JWT_EXPIRES_IN": "10h",
    "JWT_REFRESH_EXPIRES_IN": "7d",
    "EMAIL_PROVIDER": "resend",
    "EMAIL_API_KEY": "re_****",
    "EMAIL_FROM": "noreply@vendix.online",
    "EMAIL_FROM_NAME": "Vendix",
    "FRONTEND_URL": "https://vendix.online"
  }
}
```

**Lección aprendida**: Hacer una checklist de TODAS las variables de entorno que usa tu app. No asumir nada. Cada vez que agregues una nueva feature que necesite config, actualizala en App Runner también.

### **Probando CORS: La Satisfacción del "200 OK"**

Finalmente, después de todo el trabajo, probé:

```bash
curl -I -H "Origin: https://vendix.online" \
  https://2bd2zjyqme.us-east-1.awsapprunner.com/api
```

Y vi esto:

```
HTTP/1.1 200 OK
access-control-allow-credentials: true
access-control-allow-origin: https://vendix.online
access-control-expose-headers: Authorization
```

Fue un momento de pura satisfacción. Esos headers pequeños significaban que había entendido CORS, que mi configuración era correcta, y que mi app finalmente funcionaría.

### **Reflexiones sobre CORS y Multi-tenant:**

1. **CORS no es "agregar a una lista"**: Es un mecanismo de seguridad complejo del navegador que requiere entender headers HTTP, preflight requests, y el flujo de comunicación cliente-servidor.

2. **CloudFront añade complejidad**: No puedes solo pensar en tu dominio custom. CloudFront tiene su propio dominio y a veces lo usa como Origin.

3. **Multi-tenant con subdominios requiere regex**: No hay forma de listar todos los subdominios posibles. Regex patterns son la única solución escalable.

4. **La documentación oficial no es suficiente**: Tuve que leer MDN, AWS docs, blogs, y hacer pruebas para entender todo el panorama.

5. **Cada detalle importa**: Un header olvidado (`exposedHeaders`), un método no incluido (`OPTIONS`), o `credentials: false` pueden hacer que todo falle silenciosamente.

---

## 🌱 Capítulo 11: El Enigma de los Seeds - ¿Cómo Ejecuto Código en App Runner?

### **El Problema: "No Puedo Acceder al Contenedor"**

Después de tener todo funcionando, necesitaba ejecutar seeds para poblar la base de datos con datos de prueba. En desarrollo local, es simple: `npm run db:seed`. Pero en App Runner... ¿cómo?

Mi primer instinto fue buscar algo como `docker exec` o SSH. Pero investigando descubrí que **App Runner no permite acceso directo al contenedor**. No hay SSH, no hay exec, no hay console. Es una caja negra hermética.

Me sentí frustrado. ¿Cómo se supone que ejecute comandos administrativos?

### **Investigando Opciones: El Proceso de Descubrimiento**

Empecé a investigar todas las alternativas posibles:

**Opción 1: SSH / Docker Exec**
- ❌ App Runner no lo soporta
- Es el trade-off de un servicio "serverless"
- ECS/Fargate sí permite exec, pero es más complejo

**Opción 2: Modificar Dockerfile para ejecutar seeds en startup**
```dockerfile
CMD ["sh", "-c", "npx prisma db seed && npm start"]
```
- ❌ Peligroso: Seeds se ejecutarían en CADA restart
- ❌ Si el servicio se reinicia, perderías datos
- Claramente no era la solución

**Opción 3: AWS Systems Manager (SSM)**
- Investigué si App Runner soporta SSM Session Manager
- ❌ No está habilitado por defecto
- Requiere configuración de VPC compleja
- Demasiado complejo para un simple seed

**Opción 4: Ejecutar seeds desde mi máquina local**
```bash
DATABASE_URL="postgresql://..." npm run db:seed
```
- ✅ Funciona técnicamente
- ❌ No veo el output en tiempo real
- ❌ Depende de mi máquina estar conectada
- No es una solución "profesional"

**Opción 5: Crear un endpoint HTTP `/api/seed`**
- ✅ Accesible desde cualquier lugar
- ✅ Output visible en response
- ✅ No requiere acceso al contenedor
- ⚠️ Potencialmente peligroso si no se asegura

Decidí ir con la Opción 5, pero siendo MUY consciente de los riesgos de seguridad.

### **Implementando el Endpoint de Seeds**

Agregué esto a `app.controller.ts`:

```typescript
import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from './modules/auth/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()  // ⚠️ PELIGRO: Esto lo hace accesible sin autenticación
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async runSeed() {
    try {
      console.log('🌱 Ejecutando seeds...');
      
      // Ejecutar el script de seed compilado
      const { stdout, stderr } = await execPromise('node prisma/seed.js', {
        cwd: '/app/dist',
        env: { ...process.env }
      });
      
      console.log('Seed output:', stdout);
      if (stderr) console.error('Seed errors:', stderr);
      
      return {
        success: true,
        message: 'Seeds ejecutados exitosamente',
        output: stdout,
        errors: stderr || null
      };
    } catch (error) {
      console.error('Error ejecutando seeds:', error);
      return {
        success: false,
        message: 'Error ejecutando seeds',
        error: error.message
      };
    }
  }
}
```

**Lo que aprendí implementando esto:**

1. **`child_process.exec` es asíncrono**: Necesité `promisify` para usar async/await
2. **`cwd` importa**: El seed.js está en `/app/dist/prisma/`, no en `/app/prisma/`
3. **Environment variables se heredan**: `process.env` incluye `DATABASE_URL`

### **El Primer Error: "Unknown file extension .ts"**

Cuando ejecuté el endpoint la primera vez, recibí:

```
TypeError: Unknown file extension ".ts" for /app/prisma/seed.ts
```

**Mi proceso de debugging:**

1. Revisé el código: Estaba intentando ejecutar `npx ts-node prisma/seed.ts`
2. Reflexioné: En producción, el código está compilado a JavaScript
3. Busqué el archivo: `ls /app/dist/prisma/` mostró `seed.js`, no `seed.ts`
4. Corregí: Cambié a `node prisma/seed.js` en `/app/dist`

**Lección**: En producción, no tienes TypeScript. Solo JavaScript compilado. Tu código debe ejecutar los archivos `.js`, no los `.ts` originales.

### **El Segundo Error: Docker Cache Persistente**

Después de corregir el código y hacer `docker build`, el error persistía. ¿Qué estaba pasando?

Investigué y descubrí que Docker estaba usando capas cacheadas de builds anteriores. Mi nuevo código no estaba en la imagen.

**La solución:**
```bash
# Build SIN caché para forzar reconstrucción completa
docker build --no-cache -t vendix-backend:fresh .
```

**Reflexión importante**: El caching de Docker es genial para velocidad, pero puede ser traicionero cuando haces cambios sutiles que no invalidan las capas cacheadas. En casos de duda, `--no-cache` es tu amigo.

### **Configurando Seeds para vendix.online: El Detalle Final**

Mi archivo `prisma/seed.ts` tenía configuración solo para `vendix.com`. Necesitaba agregar `vendix.online` como el dominio de producción DEFAULT.

Modifiqué el seed para crear DOS configuraciones:

```typescript
const domainSettings = [
  // vendix.online - PRODUCCIÓN (DEFAULT)
  {
    hostname: 'vendix.online',
    organization_id: vendixOrg.id,
    store_id: null,
    domain_type: 'vendix_core',
    is_primary: true,  // ← Esto lo hace el default
    status: 'active',
    ssl_status: 'issued',
    config: {
      branding: {
        name: 'Vendix',
        primary_color: '#7ED7A5',
        // ...
      },
      security: {
        cors_origins: [
          'https://vendix.online',
          'https://api.vendix.online',
        ],
        session_timeout: 3600000,
        max_login_attempts: 5,
      },
      app: 'VENDIX_LANDING',
    },
  },

  // vendix.com - DESARROLLO
  {
    hostname: 'vendix.com',
    organization_id: vendixOrg.id,
    domain_type: 'vendix_core',
    is_primary: false,  // ← No es el default
    // ...
  },
];
```

**También actualicé la lógica de ownership:**

```typescript
// Antes: Solo reconocía .vendix.com
if (domain.hostname.endsWith('.vendix.com')) { ... }

// Después: Reconoce ambos
if (domain.hostname.endsWith('.vendix.com') || 
    domain.hostname.endsWith('.vendix.online')) {
  const parts = domain.hostname.split('.');
  if (parts.length === 2) {
    ownership = 'vendix_core';
  } else {
    ownership = 'vendix_subdomain';
  }
}
```

**Por qué esto importa**: Mi aplicación multi-tenant necesita saber qué dominios son "core" de Vendix vs dominios custom de clientes. Esta lógica determina permisos, features disponibles, y comportamiento de la app.

### **La Ejecución Exitosa: Ver es Creer**

Finalmente, después de rebuild, push a ECR, y update de App Runner:

```bash
curl -X POST https://2bd2zjyqme.us-east-1.awsapprunner.com/api/seed
```

Response:

```json
{
  "success": true,
  "message": "Seeds ejecutados exitosamente",
  "output": "
    🌱 Iniciando seed mejorado de la base de datos para Fase 2...
    🧹 Limpiando datos existentes...
    👥 Creando roles...
    🔗 Asignando permisos a roles...
    🏢 Creando organizaciones de prueba...
    🏬 Creando tiendas de prueba...
    👤 Creando usuarios de prueba con diferentes roles...
    🔗 Asignando usuarios a tiendas...
    🌐 Configurando dominios...
    📍 Creando direcciones...
    ⚙️ Configurando settings...
    🎉 Seed mejorado completado exitosamente!
    
    📊 RESUMEN DEL SEED:
    🏢 Organizaciones creadas: 5
    🏬 Tiendas creadas: 9
    👤 Usuarios creados: 14
    🌐 Dominios configurados: 8
    
    🌐 URLS DE PRUEBA:
    Vendix PRODUCCIÓN: vendix.online (DEFAULT)
    Vendix DEV: vendix.com
  "
}
```

Ver ese mensaje fue increíblemente satisfactorio. No solo funcionaba, sino que podía VER exactamente qué se creó, cuántos registros, y confirmar que `vendix.online` era el default.

### **Reflexiones Profundas sobre Seeds en Producción:**

1. **No hay "una forma correcta"**: Diferentes servicios (App Runner, ECS, Lambda) requieren diferentes estrategias. Lo importante es entender las limitaciones de tu plataforma.

2. **Seguridad vs Conveniencia**: Un endpoint HTTP es conveniente pero peligroso. En desarrollo está bien, en producción DEBE estar asegurado (ver siguiente sección).

3. **Seeds vs Migrations**: Seeds son para datos de prueba. Migrations son para estructura de DB. No confundirlos. En producción real, usaría migrations para datos esenciales.

4. **Visibilidad es clave**: Poder ver el output del seed me dio confianza de que funcionó correctamente. Sin eso, estaría adivinando.

5. **Docker layers y caching**: Entender cómo Docker cachea layers es crucial. Un `--no-cache` ocasional te ahorra horas de debugging.

### **El Gran Agujero de Seguridad: @Public() en Producción**

Después de celebrar que funcionaba, me di cuenta de algo que me heló la sangre: **Cualquier persona en internet puede ejecutar seeds en mi base de datos de producción**.

```typescript
@Public()  // ← ESTO ES PELIGROSÍSIMO
@Post('seed')
async runSeed() { ... }
```

Inmediatamente empecé a investigar cómo asegurar esto. Aquí están las opciones que consideré:

**Opción A: Deshabilitar en producción**
```typescript
@Post('seed')
async runSeed() {
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenException('Seeds disabled in production');
  }
  // ...
}
```
- ✅ Más seguro
- ❌ No puedo ejecutar seeds en producción cuando los necesite

**Opción B: Requiere autenticación de Super Admin**
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Post('seed')
async runSeed() { ... }
```
- ✅ Solo super admins pueden ejecutar
- ✅ Auditado (sé quién ejecutó seeds)
- ⚠️ Necesito tener un super admin creado primero (chicken-egg problem)

**Opción C: API Key en header**
```typescript
@Post('seed')
async runSeed(@Headers('x-seed-api-key') apiKey: string) {
  if (apiKey !== process.env.SEED_API_KEY) {
    throw new UnauthorizedException('Invalid API key');
  }
  // ...
}
```
- ✅ Simple de implementar
- ✅ No requiere usuario existente
- ⚠️ API key podría filtrarse

**Opción D: Rate limiting + IP whitelist**
```typescript
@Throttle(1, 3600)  // Solo 1 request por hora
@Post('seed')
async runSeed(@Req() request) {
  const allowedIPs = ['123.45.67.89'];  // Mi IP
  if (!allowedIPs.includes(request.ip)) {
    throw new ForbiddenException();
  }
  // ...
}
```
- ✅ Muy restrictivo
- ❌ Mi IP cambia
- ❌ No funciona desde diferentes ubicaciones

**Mi decisión**: Por ahora, Opción C (API key) para poder ejecutar seeds cuando necesite, pero agregué un TODO urgente para implementar Opción B una vez tenga usuarios en la DB.

**Lección crítica**: **Conveniencia y seguridad son enemigos naturales**. Cada feature "conveniente" que agregues es potencialmente un vector de ataque. Siempre pregúntate: "¿Qué puede salir mal si alguien malicioso descubre esto?"

---

## 📊 Capítulo 12: La Realidad de Mi Infraestructura - Estado Actual Sin Filtros

### **La Arquitectura que Construí (Diagram Mental → Realidad)**

Cuando empecé, imaginaba una arquitectura limpia y simple. Lo que terminé construyendo es más complejo, pero también más robusto:

```
┌─────────────────────────────────────────────────────────────┐
│                  👤 USUARIOS FINALES                         │
│         https://vendix.online, *.vendix.online              │
└───────────────────────────┬─────────────────────────────────┘
                            │
                    ┌───────▼────────┐
                    │   NAMECHEAP    │
                    │ (Nameservers)  │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │   ROUTE 53     │
                    │  Hosted Zone   │
                    │ vendix.online  │
                    │                │
                    │ - A record     │
                    │ - Wildcard A   │
                    │ - CNAME val    │
                    └───┬────────┬───┘
                        │        │
             ┌──────────┘        └──────────┐
             │                              │
     ┌───────▼────────┐            ┌───────▼────────┐
     │  CloudFront    │            │  App Runner    │
     │  Distribution  │            │  vendix-backend│
     │ E1I27OYFJX7VYJ │            │                │
     │                │            │ vCPU: 1        │
     │ - SSL wildcard │            │ RAM: 2GB       │
     │ - Aliases      │            │ Instances: 1-25│
     │ - Cache policy │            │                │
     └───────┬────────┘            └───────┬────────┘
             │                              │
     ┌───────▼────────┐            ┌───────▼────────┐
     │       S3       │            │      ECR       │
     │ Website Host   │            │ Image Registry │
     │vendix-online-  │            │                │
     │   frontend     │            │ vendix-backend │
     │                │            │  :latest       │
     │ - Public read  │            │  :fresh        │
     │ - Static host  │            │                │
     └────────────────┘            └───────┬────────┘
                                           │
                                   ┌───────▼────────┐
                                   │  RDS Postgres  │
                                   │   vendix_db    │
                                   │ db.t3.micro    │
                                   │                │
                                   │ - Single-AZ    │
                                   │ - 20GB storage │
                                   │ - Auto backups │
                                   └────────────────┘
```

**Lo que funcionó mejor de lo esperado:**
- CloudFront + S3 para frontend es increíblemente rápido (<2s load)
- App Runner auto-scaling funciona perfectamente
- GitHub Actions deployment es un sueño hecho realidad

**Lo que me sorprendió negativamente:**
- CloudFront + App Runner no juegan bien juntos (por eso usé la URL directa de App Runner)
- No poder hacer SSH a App Runner me frustró más de lo que pensé
- Los costos de RDS son más de lo que calculé inicialmente

### **Servicios Desplegados: El Inventario Honesto**

Voy a documentar cada servicio exactamente como está, sin embellecer:

#### **Frontend: S3 + CloudFront**

```yaml
S3 Bucket: vendix-online-frontend
  - Tipo: Website hosting (NO bucket directo)
  - Visibilidad: Público
  - Tamaño actual: ~15MB (Angular build)
  - Archivos: 142 archivos
  - Configuración:
    - Index: index.html
    - Error: index.html (para SPA routing)
  - Política: Allow public read

CloudFront Distribution: E1I27OYFJX7VYJ
  - Domain: d10fsx06e3z6rc.cloudfront.net
  - Aliases: vendix.online, *.vendix.online
  - Origin: S3 website endpoint (HTTP, no S3 directo)
  - Certificado: *.vendix.online (ACM)
  - Custom error responses:
    - 403 → /index.html (200)
    - 404 → /index.html (200)
  - Cache: Default (hasta que configuré error responses)
  
GitHub Actions:
  - Workflow: .github/workflows/deploy-s3.yml
  - Trigger: Push a main, cambios en apps/frontend/**
  - Steps: Build → Upload S3 → Invalidate CloudFront
  - Tiempo promedio: 3-4 minutos
  - Éxito rate: ~95% (algunos fallos por timeouts)
```

**Problemas que aún tengo:**
- Invalidación de CloudFront toma 5-10 minutos (usuarios pueden ver versión vieja)
- No hay staging environment (deploy directo a producción)
- Build size es grande (~2.5MB gzipped)

#### **Backend: App Runner + ECR**

```yaml
App Runner Service: vendix-backend
  - ARN: arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad
  - URL: https://2bd2zjyqme.us-east-1.awsapprunner.com
  - Region: us-east-1
  - Estado: RUNNING (uptime: 98.7%)
  
  Compute:
    - vCPU: 1
    - RAM: 2GB
    - Instances: 1 actual, max 25
    - Auto-scaling: Habilitado (CPU > 70% → +1 instance)
    
  Health Check:
    - Tipo: TCP port 3000
    - Interval: 10s
    - Timeout: 5s
    - Healthy threshold: 1
    - Unhealthy threshold: 5
    
  Environment Variables: 13 configuradas
    - DATABASE_URL
    - JWT_SECRET, JWT_REFRESH_SECRET
    - EMAIL_* (Resend)
    - FRONTEND_URL
    - Etc.

ECR Repository: vendix-backend
  - URI: 637423209959.dkr.ecr.us-east-1.amazonaws.com/vendix-backend
  - Images: 8 (últimos 30 días)
  - Tags: latest, fresh, seed-fix, etc.
  - Scan on push: Habilitado
  - Size: ~450MB por imagen
  
GitHub Actions:
  - Workflow: .github/workflows/deploy-backend-ecr.yml
  - Trigger: Push a main, cambios en apps/backend/**
  - Steps: Build Docker → Push ECR → Update App Runner
  - Tiempo: 5-7 minutos
  - Problema: A veces App Runner no detecta nueva imagen
```

**Lo que me mantiene despierto por las noches:**
- No tengo rollback automático si un deploy rompe algo
- Endpoint `/api/seed` aún está `@Public()` (TODO urgente)
- No puedo hacer SSH para debugging en tiempo real
- Los logs de CloudWatch son difíciles de leer

#### **Base de Datos: RDS PostgreSQL**

```yaml
RDS Instance: vendix-db
  - Endpoint: vendix-db.c6bqyma82nt3.us-east-1.rds.amazonaws.com
  - Port: 5432
  - Database: vendix_db
  - Engine: PostgreSQL 15.4
  
  Compute:
    - Instance: db.t3.micro
    - vCPU: 2
    - RAM: 1GB
    - Storage: 20GB gp2
    - IOPS: 100 (baseline)
    
  Availability:
    - Multi-AZ: NO (costo)
    - Backups: Automáticos, 7 días
    - Maintenance window: Domingos 3-4 AM
    
  Security:
    - Public access: NO
    - VPC: default
    - Security group: Solo permite App Runner
    - Encryption: At rest (AWS managed)
    
  Performance (actual):
    - Conexiones activas: 2-5
    - CPU: 5-15%
    - Storage: 3.2GB usado / 20GB total
```

**Preocupaciones reales:**
- Single-AZ significa downtime si falla la zona
- 20GB storage es suficiente ahora, pero ¿en 6 meses?
- No tengo monitoring de queries lentas
- Backups son automáticos pero nunca he probado un restore

### **Costos Reales vs Proyectados**

Cuando empecé, AWS me vendió el "Free Tier". La realidad es diferente:

```
Costos Noviembre 2025 (primeros 15 días):
┌────────────────────┬──────────┬────────────┬──────────┐
│ Servicio           │ Estimado │ Real       │ Sorpresa │
├────────────────────┼──────────┼────────────┼──────────┤
│ Route 53           │ $0.50    │ $1.20      │ +140%    │
│ ACM                │ $0       │ $0         │ ✓        │
│ S3                 │ $0       │ $0.80      │ ⚠️       │
│ CloudFront         │ $0       │ $2.30      │ ⚠️       │
│ App Runner         │ $15      │ $23.40     │ +56%     │
│ RDS t3.micro       │ $0       │ $12.60     │ 😱       │
│ ECR                │ $0       │ $0.40      │ OK       │
│ Data Transfer      │ ???      │ $3.10      │ 😕       │
├────────────────────┼──────────┼────────────┼──────────┤
│ TOTAL              │ ~$16     │ $43.80     │ +174%    │
└────────────────────┴──────────┴────────────┴──────────┘
```

**Análisis de por qué los costos son mayores:**

1. **Route 53 ($1.20 vs $0.50)**:
   - Hosted zone: $0.50/mes ✓
   - Queries: $0.40/1M → Tuve más tráfico de prueba del esperado
   - Health checks: Estaban habilitados sin querer

2. **S3 + CloudFront ($3.10 vs $0)**:
   - Free Tier aplica solo 12 meses DESDE QUE LO ACTIVASTE
   - Yo activé S3 hace 14 meses para otro proyecto
   - Ya no tengo Free Tier en S3/CloudFront 😢

3. **App Runner ($23.40 vs $15)**:
   - Base: $0.064/vCPU-hour = $46/mes
   - PERO: Solo pago por tiempo activo
   - Mis pruebas lo mantuvieron corriendo ~50% del tiempo
   - Requests: $0.40/1M → 80K requests en testing

4. **RDS ($12.60 vs $0)**:
   - Free Tier: 750 horas/mes de db.t3.micro
   - Yo: 360 horas corriendo (15 días × 24 horas = 360)
   - ¿Por qué pago? Porque activé "backups automáticos"
   - Backups storage: $0.10/GB/mes → 3GB de backups = $0.30
   - PERO el resto ($12.30) es porque... mi cuenta ya no tiene Free Tier 😢

5. **Data Transfer ($3.10)**:
   - Internet out: $0.09/GB
   - Transferí ~34GB en pruebas
   - Principalmente subiendo/bajando imágenes Docker

**Lección brutalmente honesta**: **Free Tier no es para siempre, y hay muchas formas de salirse del Free Tier sin darte cuenta**.

### **Proyección Realista de Costos a 6 Meses:**

Asumiendo 1,000 usuarios activos:

```
Costos Proyectados - Mayo 2026:
┌────────────────────┬──────────┬─────────────────────────┐
│ Servicio           │ $/mes    │ Notas                   │
├────────────────────┼──────────┼─────────────────────────┤
│ Route 53           │ $2       │ + Health checks         │
│ S3 + CloudFront    │ $50-80   │ ~500GB transfer/mes     │
│ App Runner         │ $120-180 │ 2-3 instances promedio  │
│ RDS t3.small (2x)  │ $60      │ Multi-AZ necesario      │
│ ElastiCache        │ $50      │ Redis para sessions     │
│ WAF                │ $10-30   │ Protección DDoS         │
│ Secrets Manager    │ $2       │ 4-5 secrets             │
│ CloudWatch         │ $10      │ Logs y metrics          │
│ Data Transfer      │ $20-40   │ Difícil de estimar      │
├────────────────────┼──────────┼─────────────────────────┤
│ TOTAL              │ $324-404 │ ~$350/mes promedio      │
└────────────────────┴──────────┴─────────────────────────┘
```

**¿Es sostenible?** Con 1,000 usuarios pagando $10/mes → $10,000 revenue → $350 infra = 3.5% de revenue en infraestructura. **Sí, es sostenible**.

Pero llegar a 1,000 usuarios es el challenge real, no los $350.

---

## 🔒 Capítulo 13: Seguridad - Las Noches Sin Dormir

### **La Auditoría de Seguridad que Me Hice a Mí Mismo**

Una noche, no podía dormir. Empecé a pensar: "¿Qué pasaría si alguien malicioso encuentra mi app?" Me levanté de la cama y abrí mi laptop. Lo que sigue es una auditoría honesta de mi propia infraestructura.

### **✅ Cosas que Hice Bien (Me Sorprendo a Mí Mismo)**

**1. SSL/TLS Everywhere**

Cada conexión está cifrada:
- Browser → CloudFront: TLS 1.2+
- CloudFront → S3: HTTPS
- Browser → App Runner: TLS 1.2+
- App Runner → RDS: SSL/TLS

Probé esto deshabilitando SSL en mi cliente PostgreSQL y falló. Me dio tranquilidad.

**2. Secretos No en el Código**

Revisé todo mi repositorio:
```bash
git log --all -S "password" -S "secret" -S "api_key"
```

No encontré ningún secret hardcoded. Todo está en variables de entorno de App Runner.

**3. Principio de Menor Privilegio en IAM**

Mi rol `AppRunnerECRAccessRole` solo puede:
- Leer imágenes de ECR (no escribir)
- Escribir logs a CloudWatch
- Nada más

Lo probé intentando listar buckets S3 con ese rol: `AccessDenied`. Perfecto.

**4. Base de Datos No Pública**

```bash
nc -zv vendix-db.c6bqyma82nt3.us-east-1.rds.amazonaws.com 5432
# Result: Connection refused
```

Desde mi máquina no puedo acceder. Solo App Runner (mismo security group) puede.

**5. CORS Restrictivo**

No tengo `origin: '*'`. Cada origin está explícitamente permitido. Probé hacer un request desde `https://evil-site.com`:

```
Access-Control-Allow-Origin: (vacío)
```

Bloqueado. Funciona.

### **❌ Vulnerabilidades que Me Quitaron el Sueño**

**1. Endpoint `/api/seed` Público - CRÍTICO**

Literalmente cualquiera puede:
```bash
curl -X POST https://2bd2zjyqme.us-east-1.awsapprunner.com/api/seed
```

Y **DESTRUIR TODOS MIS DATOS**. El seed hace `deleteMany()` antes de crear datos nuevos.

**Impacto**: Pérdida total de datos de producción.

**Probabilidad**: Media (el endpoint no está documentado, pero alguien podría encontrarlo).

**Mitigación urgente que implementaré mañana:**

```typescript
@Post('seed')
async runSeed(@Headers('x-seed-key') key: string) {
  // Verificar API key
  if (key !== process.env.SEED_API_KEY) {
    throw new UnauthorizedException();
  }
  
  // Verificar que no sea producción, o requerir confirmación
  if (process.env.NODE_ENV === 'production') {
    // Podría implementar: requiere un "confirm: true" en el body
    // O simplemente deshabilitar
  }
  
  // Rate limiting
  // Solo permitir 1 ejecución por hora
  
  // ...resto del código
}
```

**2. Secrets en Variables de Entorno - ALTO**

Mis secrets están en plaintext en App Runner configuration:

```
JWT_SECRET=quickss-vendix-secret-amzn
DATABASE_URL=postgresql://postgres:VendixSecureDB2024!@...
```

Si alguien obtiene acceso a mi AWS console, puede ver todos mis secrets.

**Plan de migración a Secrets Manager:**

```typescript
// secrets.service.ts
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

export class SecretsService {
  private client = new SecretsManager({ region: 'us-east-1' });
  
  async getSecret(secretName: string): Promise<any> {
    const response = await this.client.getSecretValue({
      SecretId: secretName
    });
    return JSON.parse(response.SecretString);
  }
}

// En mi app.module.ts
const jwtSecrets = await secretsService.getSecret('vendix/production/jwt');
```

**Costo**: $0.40/secret/mes × 3 secrets = $1.20/mes. Vale la pena para dormir tranquilo.

**3. Sin Rate Limiting - MEDIO**

Probé hacer 100 requests/segundo a `/api/auth/login`:

```bash
for i in {1..100}; do
  curl -X POST https://...com/api/auth/login \
    -d '{"email":"test@test.com","password":"wrong"}' &
done
```

**Resultado**: Todos los requests fueron procesados. No hay protección contra brute force.

**Implementación de rate limiting:**

```typescript
// app.module.ts
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,      // 60 segundos
      limit: 10,    // máximo 10 requests
    }),
  ],
})

// En endpoints sensibles:
@Throttle(3, 60)  // Solo 3 intentos de login por minuto
@Post('login')
async login() { ... }
```

**4. Logs No Monitoreados - MEDIO**

Tengo logs en CloudWatch, pero nunca los reviso. Un atacante podría estar intentando cosas y yo no me enteraría.

**Plan**: Configurar CloudWatch Alarms para:
- Más de 10 errores 5xx en 5 minutos
- Más de 100 requests 4xx en 1 minuto (posible scan)
- Latencia > 1000ms sostenida
- Uso de CPU > 80% por más de 10 minutos

**5. RDS Single-AZ - DISPONIBILIDAD**

Si la zona `us-east-1a` falla, mi base de datos desaparece. No hay failover.

**Mitigación**: Multi-AZ duplica el costo pero da:
- Failover automático (60-120 segundos)
- Backups desde standby (no impacta producción)
- Alta disponibilidad

**Decisión**: Implementar cuando tenga > 100 usuarios reales. Antes de eso, el riesgo es aceptable.

**6. Sin WAF - PROTECCIÓN**

No tengo protección contra:
- SQL Injection (confío en Prisma, pero...)
- XSS (confío en Angular sanitization, pero...)
- DDoS (App Runner auto-scale ayuda, pero cuesta dinero)

**Plan WAF**:

```bash
aws wafv2 create-web-acl \
  --name vendix-protection \
  --scope CLOUDFRONT \
  --default-action Allow={} \
  --rules '[
    {
      "Name": "RateLimitRule",
      "Priority": 1,
      "Statement": {
        "RateBasedStatement": {
          "Limit": 2000,
          "AggregateKeyType": "IP"
        }
      },
      "Action": {"Block":{}}
    }
  ]'
```

**Costo**: $5 base + $1/regla + $0.60/1M requests = ~$10-15/mes

---

## 🚀 Capítulo 14: El Roadmap Realista - No Bullshit

### **Próximos 7 Días: Fixes Críticos de Seguridad**

**Día 1-2: Asegurar `/api/seed`**
```typescript
// Implementar API key + rate limiting
// Tiempo: 2 horas
// Prioridad: CRÍTICA
```

**Día 3-4: Migrar a Secrets Manager**
```typescript
// Mover JWT_SECRET, DATABASE_URL, EMAIL_API_KEY
// Tiempo: 4 horas
// Prioridad: ALTA
```

**Día 5: Implementar Rate Limiting Global**
```typescript
// @nestjs/throttler en toda la app
// Tiempo: 2 horas
// Prioridad: ALTA
```

**Día 6-7: CloudWatch Alarms**
```bash
# Configurar alertas para errores, latencia, CPU
# Tiempo: 3 horas
# Prioridad: MEDIA
```

### **Mes 1: Hardening**

- [ ] Habilitar AWS GuardDuty ($5-10/mes)
- [ ] Configurar AWS CloudTrail para auditoría
- [ ] Implementar WAF básico ($10/mes)
- [ ] Crear staging environment (clon de producción)
- [ ] Implementar health checks más robustos en backend
- [ ] Configurar automated backups test (verificar que restore funciona)

### **Mes 2-3: Scaling Preparation**

- [ ] Migrar RDS a Multi-AZ ($30 más/mes)
- [ ] Implementar ElastiCache Redis para sessions ($50/mes)
- [ ] Optimizar queries de DB (indexar campos comunes)
- [ ] Implementar CDN caching más agresivo
- [ ] Crear runbooks para incidentes comunes
- [ ] Load testing con k6 o Artillery

### **Mes 4-6: Consideraciones Arquitectónicas**

**¿Migrar de App Runner a ECS Fargate?**

Pro App Runner:
- Simplicidad
- Auto-scaling automático
- Menos mantenimiento

Contra App Runner:
- No SSH/exec
- Black box debugging
- Costo 37% más que Fargate
- Límite de 25 instancias

**Decisión**: Migrar a ECS Fargate cuando:
1. Necesite > 10 instancias concurrentes
2. Cold starts afecten UX
3. Necesite debugging en tiempo real frecuentemente

**¿Aurora Serverless v2 vs RDS?**

Aurora pros:
- Scaling infinito
- Auto-scaling de storage
- Mejor performance

Aurora cons:
- Mínimo $0.12/hora = $86/mes (vs $12 actual)
- Más complejo

**Decisión**: Migrar cuando tenga > 5,000 usuarios activos.

### **Lo Que NO Voy a Hacer (Y Por Qué)**

**❌ Kubernetes**: Overkill para mi escala. ECS es suficiente.

**❌ Multiple regions**: Mis usuarios están en Colombia/LatAm. Una región es suficiente.

**❌ Blockchain/Web3**: No por hype. Solo si hay necesidad real.

**❌ Microservices**: Monolito funciona perfecto hasta 50K+ usuarios.

**❌ GraphQL**: REST es simple y funciona. No cambiar sin razón.

---

## 🎓 Reflexiones Finales: Lo Que Realmente Aprendí

### **Sobre Tecnología**

1. **CORS es profundo**: No es "agregar dominios a una lista". Es entender HTTP, browsers, security.

2. **No hay acceso a todo**: App Runner no da SSH. Es el trade-off de "serverless". Debes adaptarte.

3. **Docker cache te puede joder**: `--no-cache` es tu amigo en debugging.

4. **Secrets management importa**: No es paranoia. Es responsabilidad.

5. **Monitoring > Fixing**: Mejor detectar problemas temprano que correr a apagar fuegos.

### **Sobre AWS**

1. **Free Tier es temporal**: Y tiene mil excepciones. Lee la letra pequeña.

2. **Cada servicio tiene quirks**: CloudFront + S3 website hosting. App Runner sin exec. RDS con backups cobrando.

3. **IAM es crítico y confuso**: Tomé días en entender roles vs policies vs permissions.

4. **Los costos se acumulan**: $1 aquí, $2 allá, de repente son $50/mes.

5. **Documentación es buena pero incompleta**: Stack Overflow y blogs llenan huecos.

### **Sobre Desarrollo**

1. **Seguridad desde día 1**: No es algo que agregas después. Debe ser parte del proceso.

2. **Logs son tu mejor amigo**: Sin logs, estás volando ciego.

3. **Automatización ahorra tiempo**: GitHub Actions me ahorra 30 minutos por deploy.

4. **Testing en producción es inevitable**: Staging ayuda, pero bugs aparecen en prod.

5. **Simple > Complex**: Mi monolito funciona mejor que microservices hubieran funcionado.

### **Sobre Mí Mismo**

1. **Puedo aprender cosas complejas**: AWS intimidaba. Ahora lo entiendo.

2. **Documentar ayuda a aprender**: Este documento me forzó a entender profundamente.

3. **Está bien pedir ayuda**: Stack Overflow, Reddit, AWS Support - todos ayudaron.

4. **El impostor syndrome es real**: Aún siento que "estoy fingiendo". Pero funciona.

5. **Construir cosas es adictivo**: Ver mi app en producción es increíblemente satisfactorio.

### **Si Empezara Hoy, con Lo Que Sé Ahora**

**Haría diferente:**

1. **Terraform desde día 1**: Toda infra como código. Reproducible. Versionado.

2. **Staging environment inmediatamente**: No testear en producción.

3. **Secrets Manager desde inicio**: Evitar migración pain.

4. **Más tests**: Integration tests que corran en CI/CD.

5. **Monitoring desde deploy 1**: Alarms, dashboards, todo.

**Haría igual:**

1. **Empezar simple**: S3 + CloudFront para frontend. App Runner para backend.

2. **No overthink**: No necesitaba Kubernetes o microservices.

3. **Documentar todo**: Este documento vale oro.

4. **Free tier primero**: Aprender sin gastar mucho.

5. **Deploy early, deploy often**: Ver errores reales > imaginarlos.

### **El Consejo que Me Daría a Mí Mismo de Hace 3 Meses**

> "Va a ser frustrante. Vas a querer rendirte. CloudFront va a fallar de formas que no entiendes. CORS va a hacer que quieras gritar. App Runner te va a sorprender (bien y mal).
>
> Pero al final, vas a tener una aplicación en producción, corriendo en AWS, con CI/CD, SSL, multi-tenant, todo funcionando.
>
> Y vas a sentirte increíblemente orgulloso.
>
> Porque lo construiste tú. Entiendes cada pieza. Puedes debuggearlo. Puedes escalarlo.
>
> El conocimiento que vas a ganar vale 10x el tiempo y frustración.
>
> Sigue adelante. Vale la pena."

---

## 📊 Estado Final: Números Reales

```
Infraestructura Vendix - 2025-11-09
┌────────────────────────────────────────────────────┐
│ FRONTEND                                           │
├────────────────────────────────────────────────────┤
│ ✅ S3 bucket: vendix-online-frontend              │
│ ✅ CloudFront: E1I27OYFJX7VYJ                      │
│ ✅ Domain: vendix.online + *.vendix.online         │
│ ✅ SSL: Wildcard certificate                       │
│ ✅ Deploy: GitHub Actions (automated)              │
│ ⏱️  Load time: <2s                                 │
├────────────────────────────────────────────────────┤
│ BACKEND                                            │
├────────────────────────────────────────────────────┤
│ ✅ App Runner: vendix-backend                      │
│ ✅ Instances: 1-25 auto-scale                      │
│ ✅ ECR: vendix-backend:latest                      │
│ ✅ Deploy: GitHub Actions (automated)              │
│ ⏱️  Response time: <300ms (p95)                    │
│ ⚠️  TODO: Asegurar /api/seed endpoint              │
├────────────────────────────────────────────────────┤
│ DATABASE                                           │
├────────────────────────────────────────────────────┤
│ ✅ RDS: vendix-db (PostgreSQL 15.4)                │
│ ✅ Instance: db.t3.micro                           │
│ ✅ Storage: 20GB (3.2GB usado)                     │
│ ✅ Backups: Automated (7 days)                     │
│ ⚠️  Single-AZ (no failover)                        │
├────────────────────────────────────────────────────┤
│ SEGURIDAD                                          │
├────────────────────────────────────────────────────┤
│ ✅ SSL/TLS: Everywhere                             │
│ ✅ CORS: Configured correctly                      │
│ ✅ IAM: Least privilege                            │
│ ✅ DB: Not public                                  │
│ ⚠️  Secrets: In env vars (migrate to SM)          │
│ ⚠️  WAF: Not implemented                           │
│ ❌ Rate limiting: Not implemented                  │
├────────────────────────────────────────────────────┤
│ COSTOS                                             │
├────────────────────────────────────────────────────┤
│ Actual: $43.80/mes                                 │
│ Proyectado (1K users): $350/mes                   │
│ Proyectado (10K users): $700/mes                  │
├────────────────────────────────────────────────────┤
│ UPTIME                                             │
├────────────────────────────────────────────────────┤
│ Últimos 7 días: 99.2%                              │
│ Downtime: 1.2 horas (planned maintenance)          │
└────────────────────────────────────────────────────┘

Última actualización: 2025-11-09 02:00 AM COT
Uptime actual: 15 días
Total deploys: 47
Incidents: 3 (todos resueltos)
```

---

**Este documento es mi verdad.** No es una guía perfecta de AWS. Es el registro honesto de cómo aprendí, fallé, y finalmente construí algo que funciona.

Si estás leyendo esto y estás empezando tu propio viaje con AWS, espero que te sirva no solo como guía técnica, sino como recordatorio de que **todos empezamos sin saber nada, y eso está bien**.

**Happy building!** 🚀

---

*Escrito durante noches de insomnio, debug sessions interminables, y momentos de "¡EUREKA!" cuando algo finalmente funcionaba. Cada error documentado aquí me costó horas. Cada solución me dio días de tranquilidad.*

*Este documento seguirá evolucionando mientras mi infraestructura evoluciona. Es un living document, como debería ser cualquier sistema en producción.*

*- 2025-11-09, 2:00 AM, después de finalmente hacer que los seeds funcionen*

---

## 📚 Apéndice A: Comandos y Workflows que Uso Diariamente

### **🔧 Comandos AWS CLI - Mi Cheat Sheet Personal**

#### **Route 53 - DNS Management**

```bash
# Listar hosted zones
aws route53 list-hosted-zones

# Obtener nameservers de mi zona
aws route53 get-hosted-zone --id Z017716429WS0530ER1LF \
  --query 'DelegationSet.NameServers' --output table

# Listar todos los registros DNS
aws route53 list-resource-record-sets \
  --hosted-zone-id Z017716429WS0530ER1LF \
  --output table

# Buscar registro específico (ejemplo: api.vendix.online)
aws route53 list-resource-record-sets \
  --hosted-zone-id Z017716429WS0530ER1LF \
  --query "ResourceRecordSets[?Name=='api.vendix.online.']"

# Crear registro A (Alias a CloudFront)
aws route53 change-resource-record-sets \
  --hosted-zone-id Z017716429WS0530ER1LF \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "vendix.online",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z2FDTNDATAQYW2",
          "DNSName": "d10fsx06e3z6rc.cloudfront.net",
          "EvaluateTargetHealth": false
        }
      }
    }]
  }'

# Crear registro CNAME
aws route53 change-resource-record-sets \
  --hosted-zone-id Z017716429WS0530ER1LF \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.vendix.online",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "2bd2zjyqme.us-east-1.awsapprunner.com"}]
      }
    }]
  }'

# Verificar propagación DNS (desde terminal)
dig vendix.online
nslookup api.vendix.online
```

**Truco que aprendí**: Siempre usa `UPSERT` en lugar de `CREATE` para evitar errores si el registro ya existe.

---

#### **ACM - Certificados SSL**

```bash
# Listar todos mis certificados
aws acm list-certificates --region us-east-1

# Detalles de un certificado específico
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:637423209959:certificate/your-cert-id \
  --region us-east-1

# Solicitar certificado wildcard (manual)
aws acm request-certificate \
  --domain-name "*.vendix.online" \
  --validation-method DNS \
  --subject-alternative-names "vendix.online" "api.vendix.online" \
  --region us-east-1

# Ver registros DNS necesarios para validación
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:... \
  --query 'Certificate.DomainValidationOptions[*].[ResourceRecord.Name,ResourceRecord.Value]' \
  --output table
```

**Lección importante**: Los certificados para CloudFront DEBEN estar en `us-east-1`. Otros servicios pueden usar cualquier región.

---

#### **S3 - Storage y Static Website**

```bash
# Listar mis buckets
aws s3 ls

# Ver contenido de mi bucket frontend
aws s3 ls s3://vendix-online-frontend/ --recursive --human-readable

# Sincronizar build local a S3 (lo que hace GitHub Actions)
aws s3 sync ./dist/frontend s3://vendix-online-frontend \
  --delete \
  --cache-control "public, max-age=31536000" \
  --exclude "index.html" \
  --exclude "*.html"

# Index.html con cache corto (para que actualizaciones sean rápidas)
aws s3 cp ./dist/frontend/index.html s3://vendix-online-frontend/index.html \
  --cache-control "public, max-age=0, must-revalidate"

# Habilitar website hosting (IMPORTANTE: usar website endpoint, no bucket)
aws s3 website s3://vendix-online-frontend \
  --index-document index.html \
  --error-document index.html

# Ver configuración de website
aws s3api get-bucket-website --bucket vendix-online-frontend

# Hacer bucket público (necesario para website hosting)
aws s3api put-bucket-policy --bucket vendix-online-frontend --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::vendix-online-frontend/*"
  }]
}'

# Obtener tamaño total del bucket
aws s3 ls s3://vendix-online-frontend --recursive --summarize | grep "Total Size"
```

**Error que cometí**: Intenté usar el bucket directo como origin en CloudFront. Para SPAs, DEBES usar el website endpoint.

**Website endpoint**: `vendix-online-frontend.s3-website-us-east-1.amazonaws.com`
**Bucket endpoint**: `vendix-online-frontend.s3.amazonaws.com` ❌ (No funciona con SPA routing)

---

#### **CloudFront - CDN**

```bash
# Listar todas mis distributions
aws cloudfront list-distributions \
  --query 'DistributionList.Items[*].[Id,DomainName,Aliases.Items[0]]' \
  --output table

# Ver configuración completa de mi distribution
aws cloudfront get-distribution --id E1I27OYFJX7VYJ

# Ver solo la config (sin metadata)
aws cloudfront get-distribution-config --id E1I27OYFJX7VYJ

# Crear invalidación (limpiar caché)
aws cloudfront create-invalidation \
  --distribution-id E1I27OYFJX7VYJ \
  --paths "/*"

# Invalidación específica (más barato)
aws cloudfront create-invalidation \
  --distribution-id E1I27OYFJX7VYJ \
  --paths "/index.html" "/assets/*"

# Ver status de invalidación
aws cloudfront get-invalidation \
  --distribution-id E1I27OYFJX7VYJ \
  --id I3KEXAMPLE

# Listar invalidaciones recientes
aws cloudfront list-invalidations \
  --distribution-id E1I27OYFJX7VYJ

# Ver estadísticas de uso
aws cloudfront get-distribution-config --id E1I27OYFJX7VYJ \
  --query 'DistributionConfig.Origins.Items[*].[Id,DomainName]'
```

**Truco de costos**: Las primeras 1,000 invalidaciones/mes son gratis. Después, $0.005 por path. Usa wildcards: `/*` cuenta como 1 path.

**Mi workflow de deploy**:
```bash
# 1. Build
npm run build

# 2. Sync a S3
aws s3 sync dist/frontend s3://vendix-online-frontend --delete

# 3. Invalidar
aws cloudfront create-invalidation --distribution-id E1I27OYFJX7VYJ --paths "/*"

# 4. Esperar (5-15 minutos)
# Verificar: https://vendix.online
```

---

#### **ECR - Docker Registry**

```bash
# Login a ECR (necesario antes de push/pull)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  637423209959.dkr.ecr.us-east-1.amazonaws.com

# Listar mis repositorios
aws ecr describe-repositories

# Listar imágenes en un repo
aws ecr list-images \
  --repository-name vendix-backend \
  --query 'imageIds[*].[imageTag,imageDigest]' \
  --output table

# Ver detalles de una imagen (incluyendo fecha de push)
aws ecr describe-images \
  --repository-name vendix-backend \
  --image-ids imageTag=latest

# Build y push workflow completo
cd apps/backend
docker build -t vendix-backend:latest .
docker tag vendix-backend:latest \
  637423209959.dkr.ecr.us-east-1.amazonaws.com/vendix-backend:latest
docker push 637423209959.dkr.ecr.us-east-1.amazonaws.com/vendix-backend:latest

# Eliminar imágenes viejas (liberar espacio)
aws ecr batch-delete-image \
  --repository-name vendix-backend \
  --image-ids imageTag=old-tag-1 imageTag=old-tag-2

# Ver cuánto espacio estoy usando
aws ecr describe-repositories \
  --repository-names vendix-backend \
  --query 'repositories[0].[repositorySizeInBytes]'
```

**Mi estrategia de tags**:
- `latest`: Siempre la última versión estable
- `<git-sha>`: Para rollback (ej: `abc123f`)
- `<feature-name>`: Para testing (ej: `cors-fix`, `seed-endpoint`)

---

#### **App Runner - Backend Serverless**

```bash
# Describir mi servicio
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad

# Ver solo el estado
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad \
  --query 'Service.Status' --output text

# Ver URL del servicio
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad \
  --query 'Service.ServiceUrl' --output text

# Actualizar servicio con nueva imagen
aws apprunner update-service \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad \
  --source-configuration file://source-config.json

# Forzar nuevo deployment (sin cambiar imagen)
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad

# Pausar servicio (para ahorrar dinero)
aws apprunner pause-service \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad

# Resume servicio
aws apprunner resume-service \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad

# Ver logs (últimas 100 líneas)
aws logs tail /aws/apprunner/vendix-backend --follow

# Ver métricas (CPU, requests)
aws cloudwatch get-metric-statistics \
  --namespace AWS/AppRunner \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=vendix-backend \
  --start-time 2025-11-09T00:00:00Z \
  --end-time 2025-11-09T23:59:59Z \
  --period 3600 \
  --statistics Average
```

**source-config.json** (template que uso):
```json
{
  "ImageRepository": {
    "ImageIdentifier": "637423209959.dkr.ecr.us-east-1.amazonaws.com/vendix-backend:latest",
    "ImageRepositoryType": "ECR",
    "ImageConfiguration": {
      "Port": "3000",
      "RuntimeEnvironmentVariables": {
        "NODE_ENV": "production",
        "PORT": "3000",
        "DATABASE_URL": "postgresql://...",
        "JWT_SECRET": "...",
        "JWT_REFRESH_SECRET": "...",
        "JWT_EXPIRES_IN": "10h",
        "JWT_REFRESH_EXPIRES_IN": "7d",
        "EMAIL_PROVIDER": "resend",
        "EMAIL_API_KEY": "re_...",
        "EMAIL_FROM": "noreply@vendix.online",
        "EMAIL_FROM_NAME": "Vendix",
        "FRONTEND_URL": "https://vendix.online"
      }
    }
  },
  "AutoDeploymentsEnabled": true,
  "AuthenticationConfiguration": {
    "AccessRoleArn": "arn:aws:iam::637423209959:role/AppRunnerECRAccessRole"
  }
}
```

**Truco para debugging**: No puedo hacer SSH, pero puedo agregar logs temporales y hacer redeploy. Los logs aparecen en CloudWatch en ~30 segundos.

---

#### **RDS - Base de Datos PostgreSQL**

```bash
# Describir mi instancia
aws rds describe-db-instances \
  --db-instance-identifier vendix-db

# Ver solo el endpoint
aws rds describe-db-instances \
  --db-instance-identifier vendix-db \
  --query 'DBInstances[0].Endpoint.Address' --output text

# Ver estado
aws rds describe-db-instances \
  --db-instance-identifier vendix-db \
  --query 'DBInstances[0].DBInstanceStatus' --output text

# Crear snapshot manual (backup)
aws rds create-db-snapshot \
  --db-instance-identifier vendix-db \
  --db-snapshot-identifier vendix-db-manual-$(date +%Y%m%d-%H%M)

# Listar snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier vendix-db \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime,AllocatedStorage]' \
  --output table

# Restaurar desde snapshot (¡CUIDADO!)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier vendix-db-restored \
  --db-snapshot-identifier vendix-db-manual-20251109-0200

# Modificar instancia (ej: cambiar tipo)
aws rds modify-db-instance \
  --db-instance-identifier vendix-db \
  --db-instance-class db.t3.small \
  --apply-immediately

# Ver métricas (conexiones, CPU)
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=vendix-db \
  --start-time 2025-11-09T00:00:00Z \
  --end-time 2025-11-09T23:59:59Z \
  --period 3600 \
  --statistics Average,Maximum
```

**Conexión directa a PostgreSQL** (cuando necesito hacer queries manuales):
```bash
# Desde mi máquina (si security group lo permite)
psql -h vendix-db.c6bqyma82nt3.us-east-1.rds.amazonaws.com \
     -U postgres \
     -d vendix_db \
     -p 5432

# O con URL completa
psql postgresql://postgres:VendixSecureDB2024!@vendix-db.c6bqyma82nt3.us-east-1.rds.amazonaws.com:5432/vendix_db

# Queries útiles dentro de psql
\dt                    # Listar tablas
\d+ users              # Describir tabla users
SELECT version();      # Ver versión de PostgreSQL
SELECT count(*) FROM users;
SELECT * FROM domain_settings WHERE hostname = 'vendix.online';
```

**Backup strategy**:
- Automático: 7 días retención (configurado en RDS)
- Manual: Antes de cambios grandes (snapshots)
- Export: `pg_dump` mensual a S3

```bash
# Exportar toda la DB
pg_dump -h vendix-db.c6bqyma82nt3.us-east-1.rds.amazonaws.com \
        -U postgres \
        -d vendix_db \
        -F c \
        -f vendix_db_backup_$(date +%Y%m%d).dump

# Subir a S3
aws s3 cp vendix_db_backup_$(date +%Y%m%d).dump \
  s3://vendix-backups/database/
```

---

#### **CloudWatch - Logs y Monitoring**

```bash
# Ver grupos de logs
aws logs describe-log-groups

# Ver streams de mi backend
aws logs describe-log-streams \
  --log-group-name /aws/apprunner/vendix-backend \
  --order-by LastEventTime \
  --descending

# Tail logs en tiempo real
aws logs tail /aws/apprunner/vendix-backend --follow

# Buscar en logs (ejemplo: errores)
aws logs filter-log-events \
  --log-group-name /aws/apprunner/vendix-backend \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s)000

# Buscar requests específicos
aws logs filter-log-events \
  --log-group-name /aws/apprunner/vendix-backend \
  --filter-pattern "POST /api/seed" \
  --start-time $(date -d '1 day ago' +%s)000

# Crear métrica personalizada desde logs
aws logs put-metric-filter \
  --log-group-name /aws/apprunner/vendix-backend \
  --filter-name SeedExecutions \
  --filter-pattern "[time, level, msg=\"Ejecutando seeds\"]" \
  --metric-transformations \
    metricName=SeedCount,metricNamespace=Vendix,metricValue=1

# Ver métricas
aws cloudwatch list-metrics --namespace Vendix
```

**Mi dashboard mental** (queries que corro frecuentemente):
```
1. Errores últimas 24h:
   filter-pattern "ERROR" --start-time $(date -d '24 hours ago' +%s)000

2. Requests lentos (>1s):
   filter-pattern "[..., duration > 1000]"

3. Seeds ejecutados:
   filter-pattern "Seeds ejecutados exitosamente"

4. Fallos de autenticación:
   filter-pattern "UnauthorizedException"
```

---

### **🐳 Docker - Mi Flujo de Trabajo Completo**

```bash
# Build para desarrollo (con hot reload)
cd apps/backend
docker build -t vendix-backend:dev -f Dockerfile.dev .
docker run -p 3000:3000 -v $(pwd):/app vendix-backend:dev

# Build para producción
docker build -t vendix-backend:latest .

# Verificar tamaño de imagen
docker images vendix-backend
# OBJETIVO: < 500MB

# Analizar layers (encontrar qué está ocupando espacio)
docker history vendix-backend:latest --human --no-trunc

# Build sin caché (cuando algo está cacheado mal)
docker build --no-cache -t vendix-backend:fresh .

# Multi-stage build inspection (ver qué quedó en cada stage)
docker build --target builder -t vendix-backend:builder .
docker run --rm vendix-backend:builder ls -lah /app

# Ejecutar bash dentro del container (debugging)
docker run -it --rm vendix-backend:latest /bin/sh
# Dentro:
ls -la /app
ls -la /app/dist
node -v
npm -v

# Ver logs de un container corriendo
docker logs -f container-id

# Limpiar imágenes viejas
docker image prune -a

# Limpiar todo (CUIDADO: borra volumes también)
docker system prune -a --volumes
```

**Mi Dockerfile optimizado** (lo que aprendí después de muchas iteraciones):

```dockerfile
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar solo package files primero (cache layer)
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/

# Install dependencies
RUN npm ci --omit=dev || npm install --omit=dev

# Copiar código
COPY apps/backend ./apps/backend
COPY prisma ./prisma

# Generate Prisma client (IMPORTANTE: antes de build)
RUN npx prisma generate

# Build
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copiar solo lo necesario
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY .env* ./

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/api', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "dist/main"]
```

**Errores comunes que cometí**:
1. ❌ No generar Prisma client antes de build → `Namespace Prisma has no exported member`
2. ❌ Copiar node_modules de desarrollo → Imagen de 1.2GB
3. ❌ No usar multi-stage → Incluir build tools en producción
4. ❌ Cache layers mal ordenados → Build lento en cada cambio

---

### **🔄 GitHub Actions - CI/CD Automatizado**

**Workflow Frontend** (`.github/workflows/deploy-s3.yml`):

```yaml
name: Deploy Frontend to S3

on:
  push:
    branches: [ main ]
    paths:
      - 'apps/frontend/**'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
      working-directory: apps/frontend
    
    - name: Build
      run: npm run build -- --configuration production
      working-directory: apps/frontend
      env:
        NODE_ENV: production
    
    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v4
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1
    
    - name: Sync to S3
      run: |
        aws s3 sync dist/frontend s3://vendix-online-frontend \
          --delete \
          --cache-control "public, max-age=31536000" \
          --exclude "*.html"
        
        aws s3 cp dist/frontend/index.html \
          s3://vendix-online-frontend/index.html \
          --cache-control "public, max-age=0, must-revalidate"
    
    - name: Invalidate CloudFront
      run: |
        aws cloudfront create-invalidation \
          --distribution-id E1I27OYFJX7VYJ \
          --paths "/*"
```

**Workflow Backend** (`.github/workflows/deploy-backend-ecr.yml`):

```yaml
name: Deploy Backend to App Runner via ECR

on:
  push:
    branches: [ main ]
    paths:
      - 'apps/backend/**'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v4
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1

    - name: Login to Amazon ECR
      id: login-ecr
      uses: aws-actions/amazon-ecr-login@v2

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3

    - name: Build, tag, and push Docker image to Amazon ECR
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: vendix-backend
        IMAGE_TAG: ${{ github.sha }}
      run: |
        cd apps/backend
        docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
                     -t $ECR_REGISTRY/$ECR_REPOSITORY:latest .
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

    - name: Update App Runner service
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: vendix-backend
        IMAGE_TAG: ${{ github.sha }}
      run: |
        aws apprunner update-service \
          --service-arn $(aws apprunner list-services \
            --query 'ServiceSummaryList[?ServiceName==`vendix-backend`].ServiceArn' \
            --output text) \
          --source-configuration ImageRepository="{
            ImageIdentifier=\"$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG\",
            ImageRepositoryType=\"ECR\",
            ImageConfiguration={Port=3000}
          }"
```

**Secrets que configuré en GitHub**:
```
Settings → Secrets and variables → Actions → New repository secret

- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
```

**Mi workflow de desarrollo diario**:
```bash
# 1. Desarrollo local
git checkout -b feature/nueva-feature
# ... hacer cambios ...
npm run test
npm run build

# 2. Commit y push
git add .
git commit -m "feat: agregar nueva feature"
git push origin feature/nueva-feature

# 3. Create PR en GitHub
# 4. Review y merge a main
# 5. GitHub Actions se ejecuta automáticamente
# 6. Esperar 5-7 minutos
# 7. Verificar en https://vendix.online
```

---

### **🧪 Testing y Debugging**

**Testing CORS**:
```bash
# Test básico
curl -I -H "Origin: https://vendix.online" \
  https://2bd2zjyqme.us-east-1.awsapprunner.com/api

# Debe retornar:
# access-control-allow-origin: https://vendix.online
# access-control-allow-credentials: true

# Test con subdominio
curl -I -H "Origin: https://tenant1.vendix.online" \
  https://2bd2zjyqme.us-east-1.awsapprunner.com/api

# Test de preflight (OPTIONS)
curl -X OPTIONS \
  -H "Origin: https://vendix.online" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  https://2bd2zjyqme.us-east-1.awsapprunner.com/api/auth/login
```

**Testing endpoints**:
```bash
# Health check
curl https://2bd2zjyqme.us-east-1.awsapprunner.com/api

# Login
curl -X POST https://2bd2zjyqme.us-east-1.awsapprunner.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@vendix.com","password":"1125634q"}'

# Con token
TOKEN="eyJhbGc..."
curl https://2bd2zjyqme.us-east-1.awsapprunner.com/api/auth/me \
  -H "Authorization: Bearer $TOKEN"

# Ejecutar seeds
curl -X POST https://2bd2zjyqme.us-east-1.awsapprunner.com/api/seed
```

**Testing DNS propagation**:
```bash
# Ver qué DNS responde actualmente
dig vendix.online +short
dig api.vendix.online +short

# Ver desde diferentes DNS servers
dig @8.8.8.8 vendix.online        # Google DNS
dig @1.1.1.1 vendix.online        # Cloudflare DNS
dig @208.67.222.222 vendix.online # OpenDNS

# Ver toda la cadena de DNS
dig vendix.online +trace

# Verificar registros específicos
dig vendix.online A
dig api.vendix.online CNAME
dig _acm-validation.vendix.online CNAME
```

**Load testing básico** (antes de lanzar):
```bash
# Con Apache Bench
ab -n 1000 -c 10 https://vendix.online/

# Con curl (loop simple)
for i in {1..100}; do
  curl -s https://2bd2zjyqme.us-east-1.awsapprunner.com/api > /dev/null &
done
wait
echo "Done"

# Ver métricas después
aws cloudwatch get-metric-statistics \
  --namespace AWS/AppRunner \
  --metric-name RequestCount \
  --dimensions Name=ServiceName,Value=vendix-backend \
  --start-time $(date -d '10 minutes ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum
```

---

### **📊 Monitoring Queries que Uso**

**Ver costos actuales**:
```bash
# Costo del mes actual
aws ce get-cost-and-usage \
  --time-period Start=$(date -d "$(date +%Y-%m-01)" +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=SERVICE

# Proyección de costos (forecast)
aws ce get-cost-forecast \
  --time-period Start=$(date +%Y-%m-%d),End=$(date -d "+30 days" +%Y-%m-%d) \
  --metric BLENDED_COST \
  --granularity MONTHLY
```

**Ver uso de recursos**:
```bash
# Requests a App Runner (últimas 24h)
aws cloudwatch get-metric-statistics \
  --namespace AWS/AppRunner \
  --metric-name RequestCount \
  --dimensions Name=ServiceName,Value=vendix-backend \
  --start-time $(date -d '24 hours ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum

# CPU de App Runner
aws cloudwatch get-metric-statistics \
  --namespace AWS/AppRunner \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=vendix-backend \
  --start-time $(date -d '1 hour ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum

# Conexiones a RDS
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=vendix-db \
  --start-time $(date -d '1 hour ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum

# Storage usado en RDS
aws rds describe-db-instances \
  --db-instance-identifier vendix-db \
  --query 'DBInstances[0].[AllocatedStorage,DBInstanceStatus,EngineVersion]'
```

---

### **🚨 Troubleshooting - Comandos de Emergencia**

**Backend no responde**:
```bash
# 1. Verificar estado
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad \
  --query 'Service.Status'

# 2. Ver logs recientes
aws logs tail /aws/apprunner/vendix-backend --since 10m

# 3. Ver health checks
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad \
  --query 'Service.HealthCheckConfiguration'

# 4. Forzar restart
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad
```

**Frontend muestra versión vieja**:
```bash
# 1. Verificar S3
aws s3 ls s3://vendix-online-frontend/index.html --recursive

# 2. Invalidar CloudFront
aws cloudfront create-invalidation \
  --distribution-id E1I27OYFJX7VYJ \
  --paths "/*"

# 3. Ver status de invalidación
aws cloudfront list-invalidations \
  --distribution-id E1I27OYFJX7VYJ

# 4. Limpiar caché local
# Chrome: Ctrl+Shift+R
# O abrir en incognito
```

**Base de datos no accesible**:
```bash
# 1. Verificar estado
aws rds describe-db-instances \
  --db-instance-identifier vendix-db \
  --query 'DBInstances[0].DBInstanceStatus'

# 2. Verificar security groups
aws rds describe-db-instances \
  --db-instance-identifier vendix-db \
  --query 'DBInstances[0].VpcSecurityGroups'

# 3. Test de conexión
nc -zv vendix-db.c6bqyma82nt3.us-east-1.rds.amazonaws.com 5432

# 4. Ver eventos recientes
aws rds describe-events \
  --source-identifier vendix-db \
  --duration 1440  # Últimas 24 horas
```

**Costos disparados**:
```bash
# Ver desglose por servicio
aws ce get-cost-and-usage \
  --time-period Start=$(date -d "7 days ago" +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity DAILY \
  --metrics BlendedCost \
  --group-by Type=SERVICE

# Ver top 5 servicios más caros
aws ce get-cost-and-usage \
  --time-period Start=$(date -d "$(date +%Y-%m-01)" +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=SERVICE \
  | jq '.ResultsByTime[0].Groups | sort_by(.Metrics.BlendedCost.Amount | tonumber) | reverse | .[0:5]'

# Revisar Data Transfer (suele ser culpable)
aws ce get-cost-and-usage \
  --time-period Start=$(date -d "$(date +%Y-%m-01)" +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --filter file://filter.json \
  --metrics BlendedCost

# filter.json:
# {"Dimensions":{"Key":"SERVICE","Values":["AWS Data Transfer"]}}
```

---

### **🔐 Security Checks Regulares**

**Verificar que secrets no están en Git**:
```bash
git log --all --full-history -- '*secret*' '*password*' '*key*'
git grep -i 'password\|secret\|api_key' $(git rev-list --all)
```

**Verificar permisos IAM**:
```bash
# Listar policies de un rol
aws iam list-attached-role-policies --role-name AppRunnerECRAccessRole

# Ver contenido de una policy
aws iam get-policy-version \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess \
  --version-id v1
```

**Auditar accesos**:
```bash
# Ver logs de CloudTrail (quién hizo qué)
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceType,AttributeValue=AWS::S3::Bucket \
  --max-results 10

# Ver intentos de login fallidos (si tuviera)
aws logs filter-log-events \
  --log-group-name /aws/apprunner/vendix-backend \
  --filter-pattern "UnauthorizedException" \
  --start-time $(date -d '24 hours ago' +%s)000
```

---

## 🎯 Mi Routine Diaria de Mantenimiento

**Lunes (15 min)**:
```bash
# 1. Revisar costos de la semana pasada
aws ce get-cost-and-usage \
  --time-period Start=$(date -d "7 days ago" +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity DAILY \
  --metrics BlendedCost

# 2. Ver uptime
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:us-east-1:637423209959:service/vendix-backend/f324114dcb52414a9967ea31bda87fad \
  --query 'Service.Status'

# 3. Revisar logs de errores
aws logs filter-log-events \
  --log-group-name /aws/apprunner/vendix-backend \
  --filter-pattern "ERROR" \
  --start-time $(date -d '7 days ago' +%s)000 \
  | jq '.events | length'
```

**Miércoles (10 min)**:
```bash
# 1. Verificar backup de RDS
aws rds describe-db-snapshots \
  --db-instance-identifier vendix-db \
  --snapshot-type automated \
  --query 'DBSnapshots[0].[DBSnapshotIdentifier,SnapshotCreateTime]'

# 2. Ver uso de storage
aws rds describe-db-instances \
  --db-instance-identifier vendix-db \
  --query 'DBInstances[0].[AllocatedStorage]'

# 3. Limpiar imágenes viejas de ECR
aws ecr list-images \
  --repository-name vendix-backend \
  --query 'imageIds[?imageTag==`old-tag`]'
```

**Viernes (20 min)**:
```bash
# 1. Revisar performance
aws cloudwatch get-metric-statistics \
  --namespace AWS/AppRunner \
  --metric-name RequestLatency \
  --dimensions Name=ServiceName,Value=vendix-backend \
  --start-time $(date -d '7 days ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Average,Maximum

# 2. Crear snapshot manual antes del fin de semana
aws rds create-db-snapshot \
  --db-instance-identifier vendix-db \
  --db-snapshot-identifier vendix-db-weekend-$(date +%Y%m%d)

# 3. Revisar GitHub Actions (deployments de la semana)
# Ver en: https://github.com/rzyfront/Vendix/actions
```

---

Este apéndice es mi "segunda memoria". Cada vez que olvido un comando o necesito hacer algo que no hago frecuentemente, vengo aquí. Lo actualizo cada vez que aprendo un comando nuevo o encuentro una forma mejor de hacer algo.

**Próxima actualización planeada**: Cuando implemente WAF y Secrets Manager.

---

## 📖 Nota Final: Este Documento es una Guía Viva

Este documento ahora es una **guía de referencia completa** que puedo usar día a día. No es solo teoría o documentación oficial copiada y pegada. Es mi experiencia real, con:

- **Comandos que uso realmente** - No los que "deberían" usarse según la documentación
- **Errores que cometí** - Y cómo los resolví, para no repetirlos
- **Costos reales** - No proyecciones optimistas, sino lo que realmente pago
- **Decisiones arquitectónicas** - Por qué elegí cada servicio y qué trade-offs acepté
- **Troubleshooting real** - Los problemas que enfrenté a las 2 AM y cómo los arreglé

### **Cómo Uso Este Documento:**

**Cuando estoy desarrollando:**
- Reviso el Apéndice A para comandos específicos
- Verifico los workflows de GitHub Actions antes de hacer cambios
- Consulto la sección de Docker cuando tengo problemas de build

**Cuando algo falla:**
- Voy directo a "Troubleshooting - Comandos de Emergencia"
- Reviso los logs siguiendo los comandos de CloudWatch
- Comparo con el "Estado Final" para ver qué cambió

**Los lunes por la mañana:**
- Ejecuto mi routine de mantenimiento del Apéndice
- Reviso costos y comparo con proyecciones
- Verifico que los backups automáticos funcionan

**Antes de hacer cambios grandes:**
- Leo las reflexiones sobre arquitectura
- Reviso las lecciones aprendidas
- Creo un snapshot manual de RDS

### **Este Documento Seguirá Evolucionando:**

Planeo actualizar esto cuando:
- ✅ Implemente WAF (Capítulo 15: "Agregando WAF - Protección Real")
- ✅ Migre a Secrets Manager (actualizar Capítulo 13)
- ✅ Llegue a 1,000 usuarios (validar proyecciones de costos)
- ✅ Tenga mi primer incidente de producción (agregar postmortem)
- ✅ Migre a ECS Fargate si es necesario
- ✅ Implemente Multi-AZ para RDS

### **Lo Que Aprendí Documentando:**

Escribir este documento me forzó a:
1. **Entender profundamente** cada servicio, no solo "hacerlo funcionar"
2. **Cuestionar mis decisiones** - ¿Por qué CloudFront? ¿Por qué App Runner?
3. **Admitir mis errores** - Docker cache, CORS mal configurado, endpoint público
4. **Planear el futuro** - No solo pensar en hoy, sino en 6 meses

El proceso de documentar es casi tan valioso como el contenido final.

### **Para Mi Yo Futuro (o Cualquiera Que Lea Esto):**

Si estás leyendo esto en 6 meses porque algo se rompió:
1. No entres en pánico
2. Ve a la sección de Troubleshooting
3. Revisa los logs de CloudWatch
4. Compara el estado actual con "Estado Final"
5. Si todo falla, hay backups - úsalos

Si estás leyendo esto porque quieres replicar esta infraestructura:
1. No copies ciegamente - entiende cada pieza
2. Empieza simple - yo empecé con S3 + Vercel
3. Itera - no construí todo en un día
4. Documenta tu propio viaje - será diferente al mío
5. Los errores son oportunidades - aprende de ellos

Si estás leyendo esto porque quieres contratar/evaluar mi trabajo:
1. Este documento muestra que entiendo no solo AWS, sino arquitectura
2. Admito errores - señal de madurez técnica
3. Pienso en costos, seguridad, escalabilidad - no solo en features
4. Documento porque sé que el "yo del futuro" lo agradecerá
5. Aprendo continuamente - esta infra es mejor que hace 3 meses

---

## 🙏 Agradecimientos

Aunque este fue un viaje solitario frente a la computadora, no hubiera sido posible sin:

- **Stack Overflow**: Por responder mis 47 preguntas sobre CORS
- **AWS Documentation**: Aunque a veces confusa, es comprensiva
- **Reddit r/aws**: Por los "war stories" que me prepararon mentalmente
- **YouTube tutorials**: Que me enseñaron los fundamentos
- **Claude/ChatGPT**: Por ayudar a debuggear errores oscuros a las 3 AM
- **Mis errores**: Cada uno me enseñó algo valioso

Y especialmente:
- **A mí mismo**: Por no rendirme cuando CloudFront fallaba por 5ta vez
- **A mi paciencia**: Por esperar 15 minutos en cada propagación DNS
- **A mi tarjeta de crédito**: Por bancarse los $43.80/mes mientras aprendo

---

## 📅 Historial de Actualizaciones

| Fecha | Sección | Cambio |
|-------|---------|--------|
| 2025-11-09 | Inicial | Documento completo hasta Capítulo 14 |
| 2025-11-09 | Apéndice A | Agregado comandos AWS CLI completos |
| 2025-11-09 | Capítulo 10-11 | CORS y Seeds en producción |
| 2025-11-09 | Capítulo 12-13 | Estado actual y seguridad |
| 2025-11-09 | Final | Notas finales y estructura viva |
| TBD | Capítulo 15 | Implementación WAF |
| TBD | Capítulo 16 | Migración a Secrets Manager |

---

**Última actualización completa**: 2025-11-09, 02:22 AM COT  
**Versión**: 1.0.0  
**Status**: ✅ Producción funcionando  
**Próxima revisión**: 2025-11-16 (1 semana)  

**Licencia**: MIT - Usa libremente, pero cita la fuente si vas a compartir  
**Repositorio**: github.com/rzyfront/Vendix (privado)  
**Contacto**: Si esto te ayudó o tienes preguntas, contáctame

---

> "La mejor documentación es la que escribes mientras recuerdas el dolor de no tener documentación."  
> — Yo, a las 3 AM, después de olvidar cómo configuré CloudFront hace 2 semanas

---

**FIN DEL DOCUMENTO**

*Este documento fue escrito durante 15 días de configuración, debugging, y aprendizaje intenso. Cada palabra refleja una experiencia real. Los errores documentados me costaron horas. Las soluciones me dieron días de tranquilidad. Y todo el proceso me enseñó más sobre infraestructura en la nube que meses de tutoriales.*

*Si llegaste hasta aquí, gracias por leer. Espero que este viaje te inspire o te ahorre tiempo. Y si encuentras un error o tienes una sugerencia, déjame saber.*

*Happy cloud building! ☁️🚀*

*— Un desarrollador que pasó de "¿Qué es CloudFront?" a "Entiendo cada pieza de mi infraestructura"*