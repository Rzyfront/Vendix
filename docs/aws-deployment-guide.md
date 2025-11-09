# 🚀 Guía de Deployment AWS - Vendix Multi-Tenant

## 📋 Overview
Configuración completa para desplegar Vendix en AWS con soporte multi-tenant vía subdominios.

### 🏗️ Arquitectura Final
```
*.vendix.online (cualquier subdominio)
    ↓
CloudFront Distribution
    ↓
    /api/* → api.vendix.online (App Runner + RDS)
    /*    → S3 bucket (frontend SPA)
```

---

## ✅ Pre-requisitos

1. **Cuenta AWS** con permisos suficientes
2. **Dominio vendix.online** comprado
3. **GitHub repository** con el código de Vendix
4. **AWS CLI** configurado localmente (opcional)
5. **Conocimientos básicos** de consola AWS

---

## 📝 Checklist de Configuración AWS

### 🔧 Paso 1: Route 53 - DNS Configuration
- [ ] **1.1 Crear Hosted Zone**
  ```
  Console AWS → Route 53 → Hosted zones → Create hosted zone
  Domain name: vendix.online
  Type: Public hosted zone
  ```
- [ ] **1.2 Anotar Nameservers**
  ```
  Copia los 4 NS records que Route 53 te da
  ```
- [ ] **1.3 Configurar Nameservers en Registrador**
  ```
  Ve a donde compraste vendix.online
  Reemplaza los nameservers con los de Route 53
  ```

### 🔐 Paso 2: ACM - SSL Certificate
- [ ] **2.1 Solicitar Certificado Wildcard**
  ```
  Console AWS → Certificate Manager → Request certificate
  Request a public certificate
  Fully qualified domain name: *.vendix.online
  Validation method: DNS validation
  ```
- [ ] **2.2 Validar Certificado**
  ```
  ACM te mostrará CNAME records
  Route 53 los creará automáticamente
  Espera a que el status sea "Issued"
  ```

### 🚀 Paso 3: App Runner - Backend Service
- [ ] **3.1 Verificar Dockerfile**
  ```
  apps/backend/Dockerfile debe existir
  apps/backend/apprunner.yaml debe existir (ya creado)
  ```
- [ ] **3.2 Crear App Runner Service**
  ```
  Console AWS → App Runner → Create service
  Source: Source code repository
  Repository provider: GitHub
  Repository URL: [tu-repo-vendix]
  Branch: main
  Deployment settings:
    - Auto-deployments: Enabled
    - Runtime: Node.js 20
    - CPU: 0.25 vCPU
    - Memory: 512 MB
  ```
- [ ] **3.3 Configurar Environment Variables**
  ```
  Environment variables:
  - NODE_ENV: production
  - DATABASE_URL: [tu RDS connection string]
  - JWT_SECRET: [tu secret]
  - FRONTEND_URL: https://vendix.online
  ```
- [ ] **3.4 Configurar Custom Domain**
  ```
  App Runner → vendix-backend → Custom domains → Add custom domain
  Domain name: api.vendix.online
  Certificate: *.vendix.online (de ACM)
  ```
- [ ] **3.5 Probar Deployment**
  ```
  Git push → Debe desplegar automáticamente
  Verificar que el service esté healthy
  ```

### 🗄️ Paso 4: RDS - Database
- [ ] **4.1 Crear RDS PostgreSQL Serverless**
  ```
  Console AWS → RDS → Create database
  Engine: PostgreSQL
  Templates: Free tier
  DB instance identifier: vendix-db
  Master username: postgres
  Master password: [contraseña segura]
  ```
- [ ] **4.2 Configurar Serverless v2**
  ```
  Capacity settings:
  - Serverless v2
  - Min ACU: 0.5
  - Max ACU: 2
  ```
- [ ] **4.3 Configurar Connectivity**
  ```
  Connectivity:
  - VPC security group: Create new
  - Public access: Yes (para desarrollo)
  ```
- [ ] **4.4 Obtener Connection String**
  ```
  Una vez creada, copia el connection string
  Formato: postgresql://username:password@host:port/database
  ```

### 📦 Paso 5: S3 - Frontend Bucket
- [ ] **5.1 Crear S3 Bucket**
  ```
  Console AWS → S3 → Create bucket
  Bucket name: vendix-online-frontend
  Region: us-east-1 (misma que CloudFront)
  Block all public access: UNCHECKED
  Bucket Versioning: Enabled
  ```
- [ ] **5.2 Configurar Static Website Hosting**
  ```
  Properties → Static website hosting
  Enable: Yes
  Index document: index.html
  Error document: index.html (para SPA routing)
  ```
- [ ] **5.3 Configurar Bucket Policy**
  ```
  Permissions → Bucket policy → Edit
  Pegar la siguiente policy (reemplazando bucket name):
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

### 🌐 Paso 6: CloudFront - CDN Distribution
- [ ] **6.1 Crear CloudFront Distribution**
  ```
  Console AWS → CloudFront → Create distribution
  Origin domain: vendix-online-frontend.s3.amazonaws.com
  Origin access: Legacy access identities (OAI)
  Viewer protocol policy: Redirect HTTP to HTTPS
  Alternate domain names (CNAMEs):
    - vendix.online
    - *.vendix.online
  Custom SSL certificate: *.vendix.online (de ACM)
  Default root object: index.html
  ```
- [ ] **6.2 Configurar Cache Behavior para API**
  ```
  Una vez creada → Behaviors tab → Create behavior
  Path pattern: /api/*
  Origin: Custom origin
  Origin domain: api.vendix.online
  Protocol: HTTPS only
  Allowed HTTP methods: GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE
  Cache policy: Managed-CachingDisabled
  Origin request policy: Managed-AllViewer
  Forward headers: Host (¡importante!)
  ```
- [ ] **6.3 Configurar Default Behavior**
  ```
  Path pattern: Default (*)
  Cache policy: Managed-CachingOptimized
  Origin request policy: Managed-UserAgentRefererHeaders
  Forward headers: Host
  Compress: Yes
  ```

### 🌍 Paso 7: Route 53 - DNS Records
- [ ] **7.1 Record para Dominio Principal**
  ```
  Route 53 → vendix.online → Create record
  Name: (vacío o @)
  Type: A
  Alias: Yes
  Route traffic to: CloudFront distribution [tu-distribution-id]
  ```
- [ ] **7.2 Record para API**
  ```
  Create record
  Name: api
  Type: CNAME
  Value: [tu-app-runner-custom-domain]
  TTL: 300
  ```
- [ ] **7.3 Record Wildcard para Tenants**
  ```
  Create record
  Name: *
  Type: A
  Alias: Yes
  Route traffic to: CloudFront distribution [misma-distribution-id]
  ```

### 🔑 Paso 8: GitHub Actions - Secrets
- [ ] **8.1 Configurar AWS Secrets**
  ```
  GitHub → tu-repo → Settings → Secrets and variables → Actions
  Secrets necesarios:
  - AWS_ACCESS_KEY_ID
  - AWS_SECRET_ACCESS_KEY
  - AWS_ACCOUNT_ID
  ```
- [ ] **8.2 Actualizar CloudFront Distribution ID**
  ```
  Editar .github/workflows/deploy-s3.yml
  Reemplazar TU_NUEVO_DISTRIBUTION_ID con el ID real
  ```

### 🧪 Paso 9: Testing y Validación
- [ ] **9.1 Deploy Frontend**
  ```
  git add .
  git commit -m "Configuración AWS ready"
  git push origin main
  ```
- [ ] **9.2 Verificar Deployments**
  ```
  GitHub Actions → Actions → Ver que los workflows pasen
  ```
- [ ] **9.3 Tests básicos**
  ```bash
  # Test 1: Dominio principal
  curl https://vendix.online

  # Test 2: API endpoint
  curl https://api.vendix.online/api/public/config/frontend

  # Test 3: Subdominio tenant
  curl https://tenant1.vendix.online
  ```
- [ ] **9.4 Verificar SSL**
  ```
  Acceder a https://vendix.online
  Verificar que el certificado sea válido
  Probar con varios subdominios
  ```

---

## 🔧 Troubleshooting

### Common Issues

#### **CloudFront Access Denied**
```bash
# Verificar S3 bucket policy
# Verificar OAI configuration
# Revisar CloudFront Origin settings
```

#### **Custom Domain Not Working**
```bash
# Verificar ACM certificate status
# Verificar Route 53 records
# Wait for DNS propagation (5-30 min)
```

#### **App Runner Not Deploying**
```bash
# Verificar GitHub connection
# Check Dockerfile and apprunner.yaml
# Review CloudWatch logs
```

#### **Database Connection Issues**
```bash
# Verify RDS security group allows access
# Check connection string format
# Test with local connection first
```

---

## 💰 Costos Estimados (Desarrollo)

| Servicio | Costo Mensual | Nota |
|----------|---------------|------|
| App Runner | $5-15 | 0.25 vCPU, 512MB |
| RDS PostgreSQL | $0-10 | Serverless, uso bajo |
| S3 Storage | $1-3 | Frontend assets |
| CloudFront | $2-5 | Data transfer + requests |
| Route 53 | $0.50 | Hosted zone |
| ACM | GRATIS | Certificados SSL |
| **TOTAL** | **$8.50-33.50** | Desarrollo |

### **Free Tier Benefits** (Primeros 12 meses):
- EC2: GRATIS (750h/mes) - *No usado con App Runner*
- RDS: GRATIS (750h/mes db.t3.micro)
- S3: 5GB storage GRATIS
- CloudFront: 50GB data transfer GRATIS

---

## 📞 Ayuda y Soporte

### **Recursos AWS:**
- [Route 53 Documentation](https://docs.aws.amazon.com/Route53/)
- [App Runner Documentation](https://docs.aws.amazon.com/apprunner/)
- [RDS PostgreSQL Documentation](https://docs.aws.amazon.com/AmazonRDS/)
- [CloudFront Documentation](https://docs.aws.amazon.com/CloudFront/)

### **Si tienes problemas:**
1. Revisa los CloudWatch logs
2. Verifica los security groups
3. Espera a la propagación de DNS
4. Contacta al soporte de AWS

---

## ✅ Post-Deployment

### **Monitoreo:**
- Configurar CloudWatch alarms
- Revisar métricas de App Runner
- Monitorear costos en AWS Billing

### **Optimizaciones:**
- Configurar CloudFront caching rules
- Optimizar database queries
- Implementar backup strategy para RDS

### **Security:**
- Rotar secrets regularmente
- Configurar VPC endpoints
- Implementar WAF en CloudFront

---

## 🎯 Resultado Final

Una vez completados todos los pasos tendrás:

✅ **vendix.online** → Tu frontend principal
✅ **api.vendix.online** → Tu backend API
✅ **tenant.vendix.online** → Frontend para cualquier tenant
✅ **SSL automático** para todos los subdominios
✅ **Auto-scaling** y **alta disponibilidad**
✅ **Costo predecible** durante desarrollo
✅ **Escalabilidad infinita** para producción

---

## 📅 Timeline Estimado

- **Setup inicial (Route 53, ACM)**: 30-60 min
- **App Runner + RDS**: 45-60 min
- **S3 + CloudFront**: 30-45 min
- **DNS Configuration**: 15-30 min
- **Testing y Debug**: 60-90 min
- **Total**: 3-5 horas

**Nota**: Algunos pasos como propagación DNS pueden tomar más tiempo.