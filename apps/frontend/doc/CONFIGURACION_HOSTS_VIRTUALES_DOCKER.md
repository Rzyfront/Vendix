# Configuración de Hosts Virtuales para Desarrollo con Docker

> ACTUALIZACIÓN (Arquitectura Multi‑Tenant Escalable)  
> Este documento ha sido ampliado para reflejar un enfoque progresivo: **entorno de desarrollo simple** + **ruta clara hacia producción escalable y segura** para soportar miles de organizaciones, tiendas y dominios personalizados.

## 🚀 Objetivo General
Vendix es una plataforma SaaS multi‑tenant donde:
1. Un usuario se registra en `www.vendix.com` → crea Organización inicial + primera Tienda.
2. La organización recibe automáticamente un subdominio: `orgslug.vendix.com`.
3. Cada tienda puede tener:
  - Subdominio propio bajo vendix: `store.orgslug.vendix.com` (opcional).
  - Dominio personalizado: `midominio.com` (apuntado por DNS del cliente).
4. El backend resuelve contexto (org / store / entorno) a partir del `Host` + cabeceras auxiliares.

## 🧱 Principios de Diseño
| Principio | Dev | Producción |
|-----------|-----|------------|
| Simplicidad | Un único Nginx, sin TLS | TLS, caché, compresión, seguridad |
| Resolución de tenant | Lógica central en backend | Igual (evitar recargar Nginx) |
| Escalabilidad de dominios | Regex + cabeceras | Wildcards + gestor certificados dinámico |
| Evolución futura | Fácil migrar a Traefik/Caddy | Opcional: Traefik/Caddy para certificados |

## 🗂️ Archivos Nuevos Clave
| Archivo | Propósito |
|---------|-----------|
| `nginx.dev.conf` | Config simplificada multi‑tenant para desarrollo (sin TLS). |
| `nginx.prod.example.conf` | Plantilla base endurecida para despliegue productivo. |

En desarrollo seguirás usando `docker-compose` pero podrás cambiar a `nginx.dev.conf` sin tocar lógica interna.

## 🔄 Flujo de Resolución (Backend)
1. Nginx solo enruta: Frontend vs `/api/`.
2. Cabeceras añadidas (ejemplo): `X-Org-Candidate`, `X-Store-Candidate`, `X-Custom-Domain`.
3. Servicio de resolución valida en BD:
  - Tabla `domains`: (`hostname`, `type`, `organizationId`, `storeId`, `status`, `ssl_state`).
  - Estados: `pending_dns`, `pending_ssl`, `active`, `disabled`.
4. Cache local (in‑memory) + invalidación por evento (ej. Redis pub/sub) en producción.

## 🛣️ Camino hacia Producción
1. Empezar con `nginx.dev.conf` (ya añadido).
2. Añadir build frontend y usar `nginx.prod.example.conf`.
3. Integrar certificados:
  - Opción rápida: Traefik (labels en servicios) con wildcard + on-demand.
  - Alternativa: Certbot + wildcard `*.vendix.com` (DNS-01) y emisión individual para dominios custom.
4. Añadir observabilidad: logs estructurados + OpenTelemetry en backend.
5. Endurecer seguridad (rate limiting, WAF opcional, CSP ajustada).

## ✅ Prioridad Recomendada (Iteraciones)
1. (Hecho) Simplificar y limpiar configuración dev.
2. Backend: centralizar DomainResolution + cache.
3. Tabla `domains` + endpoints para onboarding de dominios custom.
4. Script verificación DNS: esperar registro A/CNAME correcto.
5. Generación automática de certificados (Traefik/Caddy o worker interno + Certbot).
6. Migrar Angular dev server → build estático en entornos de staging/prod.
7. Añadir métricas (tiempo resolución dominio, latencias por tenant).
8. Implementar límites (requests/min por IP + por token).

---


Este documento explica cómo configurar hosts virtuales para probar dominios reales como `www.vendix.com`, `app.vendix.com`, etc., en un entorno de desarrollo con Docker.

## 1. Prerrequisitos

Asegúrate de tener instalados:
- Docker y Docker Compose
- Nginx (para el proxy inverso)
- Editor de texto con permisos de administrador

## 2. Modificación del Archivo Hosts

Primero, necesitas mapear los dominios reales a tu máquina local editando el archivo hosts:

### En Windows:
1. Abre el Bloc de notas como administrador
2. Abre el archivo: `C:\Windows\System32\drivers\etc\hosts`
3. Agrega las siguientes líneas:
```
127.0.0.1 www.vendix.com
127.0.0.1 app.vendix.com
127.0.0.1 admin.vendix.com
127.0.0.1 api.vendix.com
127.0.0.1 www.mordoc.com
127.0.0.1 app.mordoc.com
127.0.0.1 luda.mordoc.com
127.0.0.1 admin.luda.mordoc.com
```

### En Mac/Linux:
1. Abre una terminal
2. Edita el archivo hosts:
```bash
sudo nano /etc/hosts
```
3. Agrega las mismas líneas que arriba

## 3. Modificación del docker-compose.yml

Actualiza tu archivo `docker-compose.yml` para incluir un servicio Nginx:
csdfs
```yaml
version: '3.8'

services:
  db:
    image: postgres:13
    container_name: vendix_db
    restart: always
    env_file:
      - apps/backend/.env
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - vendix_net

  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    container_name: vendix_backend
    restart: always
    env_file:
      - apps/backend/.env
    ports:
      - "3000:3000"
    depends_on:
      - db
    volumes:
      - /app/node_modules
      - ./apps/backend:/app
    networks:
      - vendix_net

  frontend:
    build:
      context: ./apps/frontend
      dockerfile: Dockerfile
      args:
        - ENV=development
    container_name: vendix_frontend
    restart: always
    ports:
      - "4200:4200"
    volumes:
      - /app/node_modules
      - ./apps/frontend:/app
    networks:
      - vendix_net

  nginx:
    image: nginx:alpine
    container_name: vendix_nginx
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - backend
      - frontend
    networks:
      - vendix_net

volumes:
  postgres_data:

networks:
  vendix_net:
    driver: bridge
```

## 4. Configuración de Nginx

Crea un archivo `nginx.conf` en la raíz del proyecto:

```nginx
events {
    worker_connections 1024;
}

http {
    # Mapa para determinar el tipo de tenant
    map $http_host $tenant_type {
        "www.vendix.com" "vendix_landing";
        "app.vendix.com" "vendix_app";
        "admin.vendix.com" "vendix_admin";
        "api.vendix.com" "vendix_api";
        default "unknown";
    }

    # Servidor para www.vendix.com
    server {
        listen 80;
        server_name www.vendix.com;
        
        location / {
            proxy_pass http://frontend:4200;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Tenant-Type "vendix_landing";
        }
        
        location /api/ {
            proxy_pass http://backend:3000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
    
    # Servidor para app.vendix.com
    server {
        listen 80;
        server_name app.vendix.com;
        
        location / {
            proxy_pass http://frontend:4200;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Tenant-Type "vendix_app";
        }
        
        location /api/ {
            proxy_pass http://backend:3000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
    
    # Servidor para admin.vendix.com
    server {
        listen 80;
        server_name admin.vendix.com;
        
        location / {
            proxy_pass http://frontend:4200;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Tenant-Type "vendix_admin";
        }
        
        location /api/ {
            proxy_pass http://backend:3000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
    
    # Servidor para api.vendix.com
    server {
        listen 80;
        server_name api.vendix.com;
        
        location / {
            proxy_pass http://backend:3000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
    
    # Servidor para dominios de organización (mordoc.com)
    server {
        listen 80;
        server_name ~^(.+)\.mordoc\.com$;
        
        location / {
            proxy_pass http://frontend:4200;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Organization "mordoc";
            proxy_set_header X-Subdomain $1;
        }
        
        location /api/ {
            proxy_pass http://backend:3000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Organization "mordoc";
            proxy_set_header X-Subdomain $1;
        }
    }
    
    # Servidor por defecto para otros dominios
    server {
        listen 80;
        server_name _;
        
        location / {
            proxy_pass http://frontend:4200;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
        
        location /api/ {
            proxy_pass http://backend:3000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

## 5. Configuración del Backend para Manejar Dominios Reales

Actualiza el servicio de resolución de dominios en el backend (`apps/backend/src/common/services/domain-resolution.service.ts`):

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Enums para tipos de dominio y entornos
export enum DomainType {
  VENDIX_CORE = 'vendix_core',
  ORGANIZATION_ROOT = 'organization_root',
  ORGANIZATION_SUBDOMAIN = 'org_subdomain',
  STORE_SUBDOMAIN = 'store_subdomain',
  STORE_CUSTOM = 'store_custom'
}

export enum AppEnvironment {
  VENDIX_LANDING = 'vendix_landing',
  VENDIX_APP = 'vendix_app',
  VENDIX_ADMIN = 'vendix_admin',
  ORG_LANDING = 'org_landing',
  ORG_ADMIN = 'org_admin',
  STORE_ADMIN = 'store_admin',
  STORE_ECOMMERCE = 'store_ecommerce'
}

export interface DomainConfig {
  domainType: DomainType;
  environment: AppEnvironment;
  organizationSlug?: string;
  storeSlug?: string;
  isVendixDomain: boolean;
  customConfig?: any;
}

@Injectable()
export class DomainResolutionService {
  constructor(private prisma: PrismaService) {}

  async resolveDomain(hostname: string): Promise<DomainConfig> {
    // Para desarrollo con Docker, manejar dominios reales
    if (hostname.includes('vendix.com')) {
      return this.resolveVendixDomain(hostname);
    }
    
    if (hostname.includes('mordoc.com')) {
      return this.resolveMordocDomain(hostname);
    }

    // Para producción, buscar en base de datos
    const domainSetting = await this.prisma.domain_settings.findFirst({
      where: { hostname },
    });

    if (!domainSetting) {
      throw new NotFoundException('Domain configuration not found');
    }

    return this.parseDomainConfig(domainSetting);
  }

  private resolveVendixDomain(hostname: string): DomainConfig {
    switch(hostname) {
      case 'www.vendix.com':
        return {
          domainType: DomainType.VENDIX_CORE,
          environment: AppEnvironment.VENDIX_LANDING,
          isVendixDomain: true,
        };
      
      case 'app.vendix.com':
        return {
          domainType: DomainType.VENDIX_CORE,
          environment: AppEnvironment.VENDIX_APP,
          isVendixDomain: true,
        };
      
      case 'admin.vendix.com':
        return {
          domainType: DomainType.VENDIX_CORE,
          environment: AppEnvironment.VENDIX_ADMIN,
          isVendixDomain: true,
        };
      
      case 'api.vendix.com':
        return {
          domainType: DomainType.VENDIX_CORE,
          environment: AppEnvironment.VENDIX_LANDING, // API no tiene entorno específico
          isVendixDomain: true,
        };
      
      default:
        // Por defecto para otros subdominios vendix
        return {
          domainType: DomainType.VENDIX_CORE,
          environment: AppEnvironment.VENDIX_LANDING,
          isVendixDomain: true,
        };
    }
  }

  private resolveMordocDomain(hostname: string): DomainConfig {
    const parts = hostname.split('.');
    
    // www.mordoc.com
    if (hostname === 'www.mordoc.com') {
      return {
        domainType: DomainType.ORGANIZATION_ROOT,
        environment: AppEnvironment.ORG_LANDING,
        organizationSlug: 'mordoc',
        isVendixDomain: false,
      };
    }
    
    // app.mordoc.com
    if (hostname === 'app.mordoc.com') {
      return {
        domainType: DomainType.ORGANIZATION_SUBDOMAIN,
        environment: AppEnvironment.ORG_ADMIN,
        organizationSlug: 'mordoc',
        isVendixDomain: false,
      };
    }
    
    // Para tiendas como luda.mordoc.com
    if (parts.length === 3 && parts[2] === 'com' && parts[1] === 'mordoc') {
      return {
        domainType: DomainType.STORE_SUBDOMAIN,
        environment: AppEnvironment.STORE_ECOMMERCE,
        organizationSlug: 'mordoc',
        storeSlug: parts[0],
        isVendixDomain: false,
      };
    }
    
    // Por defecto
    return {
      domainType: DomainType.ORGANIZATION_ROOT,
      environment: AppEnvironment.ORG_LANDING,
      organizationSlug: 'mordoc',
      isVendixDomain: false,
    };
  }

  private parseDomainConfig(domainSetting: any): DomainConfig {
    // Implementación para parsear configuración desde base de datos
    // Esta es la implementación existente en tu código
    return {
      domainType: domainSetting.type,
      environment: domainSetting.config.environment,
      organizationSlug: domainSetting.organization?.slug,
      storeSlug: domainSetting.store?.slug,
      isVendixDomain: domainSetting.hostname.includes('vendix.com'),
      customConfig: domainSetting.config,
    };
  }
}
```

## 6. Configuración del Frontend

Actualiza el entorno de desarrollo (`apps/frontend/src/environments/environment.ts`):

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://api.vendix.com', // Usar el dominio real para API
  vendixDomain: 'vendix.com',

  // Debug settings
  debugDomainDetection: true,
  debugThemeApplication: true,
  debugAuthFlow: true,
};
```

## 7. Scripts de Automatización

Crea un script para configurar automáticamente los dominios:

### setup-docker-domains.sh
```bash
#!/bin/bash

# Script para configurar dominios virtuales con Docker

echo "Configurando dominios virtuales para desarrollo con Docker..."

# Verifica sistema operativo
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    HOSTS_FILE="/etc/hosts"
    SUDO="sudo"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    HOSTS_FILE="/etc/hosts"
    SUDO="sudo"
else
    echo "Sistema operativo no soportado"
    exit 1
fi

# Backup del archivo hosts original
echo "Creando backup del archivo hosts..."
$SUDO cp $HOSTS_FILE $HOSTS_FILE.backup.$(date +%s)

# Agrega los dominios al archivo hosts
echo "Agregando dominios al archivo $HOSTS_FILE..."

$SUDO tee -a $HOSTS_FILE > /dev/null <<EOT

# Dominios Vendix para desarrollo con Docker - Agregado $(date)
127.0.0.1 www.vendix.com
127.0.0.1 app.vendix.com
127.0.0.1 admin.vendix.com
127.0.0.1 api.vendix.com
127.0.0.1 www.mordoc.com
127.0.0.1 app.mordoc.com
127.0.0.1 luda.mordoc.com
127.0.0.1 admin.luda.mordoc.com
# Fin de dominios Vendix
EOT

echo "Dominios configurados exitosamente!"
echo ""
echo "Ahora puedes ejecutar docker-compose up para iniciar los servicios"
echo "y acceder a los dominios configurados."
</script>
```

### start-dev.sh
```bash
#!/bin/bash

# Script para iniciar el entorno de desarrollo

echo "Iniciando entorno de desarrollo con Docker..."

# Construye y levanta los servicios
docker-compose up --build

echo "Entorno de desarrollo iniciado!"
echo ""
echo "Puedes acceder a los siguientes dominios:"
echo "  http://www.vendix.com - Landing principal"
echo "  http://app.vendix.com - Aplicación Vendix"
echo "  http://admin.vendix.com - Panel de administración"
echo "  http://api.vendix.com - API"
echo "  http://www.mordoc.com - Landing de organización"
echo "  http://app.mordoc.com - Admin de organización"
echo "  http://luda.mordoc.com - Tienda e-commerce"
echo "  http://admin.luda.mordoc.com - Admin de tienda"
</script>
```

## 8. Iniciar el Entorno de Desarrollo

1. Haz ejecutable los scripts:
```bash
chmod +x setup-docker-domains.sh
chmod +x start-dev.sh
```

2. Ejecuta la configuración de dominios:
```bash
./setup-docker-domains.sh
```

3. Inicia los servicios con Docker:
```bash
./start-dev.sh
```

O directamente:
```bash
docker-compose up --build
```

## 9. Acceso a los Dominios Configurados

Una vez que los servicios estén corriendo, puedes acceder a los siguientes dominios en tu navegador:

- `http://www.vendix.com` - Landing principal
- `http://app.vendix.com` - Aplicación principal
- `http://admin.vendix.com` - Panel de administración
- `http://api.vendix.com` - API endpoints
- `http://www.mordoc.com` - Landing de organización
- `http://app.mordoc.com` - Panel de administración de organización
- `http://luda.mordoc.com` - Tienda e-commerce
- `http://admin.luda.mordoc.com` - Panel de administración de tienda

## 10. Pruebas de Funcionalidad

### Prueba de Resolución de Dominios
```bash
# Verifica que los dominios resuelvan a tu máquina local
nslookup www.vendix.com
nslookup app.vendix.com
```

### Prueba de Acceso HTTP
```bash
# Verifica que puedes acceder a los dominios
curl -H "Host: www.vendix.com" http://localhost
curl -H "Host: app.vendix.com" http://localhost
```

### Prueba de API
```bash
# Verifica que la API sea accesible
curl http://api.vendix.com/api/health
```

## 11. Solución de Problemas

### Problemas Comunes

1. **Los dominios no resuelven:**
   - Verifica que las entradas en el archivo hosts sean correctas
   - Reinicia el servicio de DNS en tu sistema
   - Limpia la caché de DNS

2. **Nginx no inicia:**
   - Verifica la sintaxis del archivo nginx.conf: `docker-compose exec nginx nginx -t`
   - Asegúrate de que no haya otros servicios usando el puerto 80

3. **Los contenedores no se comunican:**
   - Verifica que todos los servicios estén en la misma red Docker
   - Usa los nombres de servicio definidos en docker-compose.yml para la comunicación interna

4. **Problemas de permisos:**
   - Asegúrate de ejecutar los scripts con permisos adecuados
   - En Linux/Mac, usa sudo cuando sea necesario

### Verificación de Logs

Para diagnosticar problemas, revisa los logs de los contenedores:

```bash
# Ver logs de Nginx
docker-compose logs nginx

# Ver logs del backend
docker-compose logs backend

# Ver logs del frontend
docker-compose logs frontend
```

## 12. Configuración Adicional para Desarrollo Avanzado

### Variables de Entorno

Asegúrate de que tus archivos `.env` estén correctamente configurados:

**apps/backend/.env:**
```
DATABASE_URL="postgresql://username:password@db:5432/vendix_db?schema=public"
JWT_SECRET="your-super-secret-jwt-key-here"
JWT_REFRESH_SECRET="your-super-refresh-secret-key-here"
FRONTEND_URL=http://www.vendix.com
PORT=3000
NODE_ENV="development"
```

### Configuración de CORS

Actualiza la configuración de CORS en el backend para aceptar los dominios configurados:

```typescript
// En tu módulo de configuración de CORS
const corsOptions = {
  origin: [
    'http://www.vendix.com',
    'http://app.vendix.com',
    'http://admin.vendix.com',
    'http://www.mordoc.com',
    'http://app.mordoc.com',
    'http://luda.mordoc.com',
    'http://admin.luda.mordoc.com',
    // Agrega otros dominios según sea necesario
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
};
```

Esta configuración te permitirá desarrollar y probar tu aplicación multi-tenant usando dominios reales en un entorno Dockerizado, manteniendo la funcionalidad completa del sistema de detección de dominios y configuración dinámica.