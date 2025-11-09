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

*Este documento fue escrito durante el proceso real de configuración, con cada error y solución documentados tal como ocurrieron. No es una guía perfecta, pero es honesta sobre el proceso de aprendizaje.*