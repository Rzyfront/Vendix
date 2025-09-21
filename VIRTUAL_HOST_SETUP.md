# Virtual Host Configuration for Vendix Local Development

This document provides a comprehensive guide to setting up virtual hosts for local development of the Vendix multitenant application. This setup will allow you to test all domain types and tenant scenarios locally.

## 1. Required Virtual Hosts

For comprehensive testing of the multitenant architecture, you'll need to configure the following virtual hosts:

### Core Vendix Domains
- `vendix.localhost` - Main landing page
- `admin.vendix.localhost` - Super admin panel
- `api.vendix.localhost` - API endpoint

### Organization Domains (Example: Mordoc)
- `mordoc.localhost` - Organization landing page
- `app.mordoc.localhost` - Organization admin panel

### Store Domains (Example: Luda)
- `luda.mordoc.localhost` - Store e-commerce frontend
- `admin.luda.mordoc.localhost` - Store admin panel

### Custom Store Domains
- `luda.localhost` - Custom store domain
- `admin.luda.localhost` - Custom store admin domain

### Development Testing Domains
- `tenant1.vendix.localhost` - Generic tenant for testing
- `store1.tenant1.vendix.localhost` - Generic store for testing

## 2. Hosts File Configuration

The easiest way to set up virtual hosts locally is by modifying your system's hosts file:

### Windows
1. Open Notepad as Administrator
2. Open file: `C:\Windows\System32\drivers\etc\hosts`
3. Add the following entries:
```
127.0.0.1 vendix.localhost
127.0.0.1 admin.vendix.localhost
127.0.0.1 api.vendix.localhost
127.0.0.1 mordoc.localhost
127.0.0.1 app.mordoc.localhost
127.0.0.1 luda.mordoc.localhost
127.0.0.1 admin.luda.mordoc.localhost
127.0.0.1 luda.localhost
127.0.0.1 admin.luda.localhost
127.0.0.1 tenant1.vendix.localhost
127.0.0.1 store1.tenant1.vendix.localhost
```

### Mac/Linux
1. Open terminal
2. Edit the hosts file:
```bash
sudo nano /etc/hosts
```
3. Add the same entries as above

### Alternative: dnsmasq Configuration (Advanced)

For a more flexible solution that automatically resolves all `.localhost` domains:

1. Install dnsmasq:
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install dnsmasq

# macOS
brew install dnsmasq
```

2. Configure dnsmasq:
Create `/etc/dnsmasq.d/vendix.conf`:
```bash
# Wildcard domains for Vendix development
address=/.localhost/127.0.0.1

# Cache configuration
cache-size=1000
```

3. Configure system DNS:
```bash
# Linux - Edit /etc/resolv.conf
nameserver 127.0.0.1
nameserver 8.8.8.8

# macOS - Create resolver
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/localhost
```

4. Start dnsmasq service:
```bash
# Linux
sudo systemctl enable dnsmasq
sudo systemctl start dnsmasq

# macOS
sudo brew services start dnsmasq
```

## 3. Nginx Configuration

To properly route requests based on the host header, we'll use Nginx as a reverse proxy:

### Install Nginx
```bash
# Ubuntu/Debian
sudo apt-get install nginx

# macOS
brew install nginx
```

### Nginx Configuration File
Create `/etc/nginx/sites-available/vendix`:
```nginx
# Upstream definitions
upstream frontend {
    server localhost:4200;
}

upstream backend {
    server localhost:3000;
}

# Vendix Core Domains
server {
    listen 80;
    server_name vendix.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name admin.vendix.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name api.vendix.localhost;
    
    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Organization Domains
server {
    listen 80;
    server_name mordoc.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tenant-Type "organization_landing";
        proxy_set_header X-Organization-Slug "mordoc";
    }
}

server {
    listen 80;
    server_name app.mordoc.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tenant-Type "organization_admin";
        proxy_set_header X-Organization-Slug "mordoc";
    }
}

# Store Domains
server {
    listen 80;
    server_name luda.mordoc.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tenant-Type "store_ecommerce";
        proxy_set_header X-Organization-Slug "mordoc";
        proxy_set_header X-Store-Slug "luda";
    }
}

server {
    listen 80;
    server_name admin.luda.mordoc.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tenant-Type "store_admin";
        proxy_set_header X-Organization-Slug "mordoc";
        proxy_set_header X-Store-Slug "luda";
    }
}

# Custom Store Domains
server {
    listen 80;
    server_name luda.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tenant-Type "store_ecommerce";
        proxy_set_header X-Store-Slug "luda";
    }
}

server {
    listen 80;
    server_name admin.luda.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tenant-Type "store_admin";
        proxy_set_header X-Store-Slug "luda";
    }
}

# API Routes for all domains
server {
    listen 80;
    server_name ~^(.+)\.localhost$;
    
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tenant-Domain $1;
    }
}

# Development Testing Domains
server {
    listen 80;
    server_name tenant1.vendix.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tenant-Type "organization_landing";
        proxy_set_header X-Organization-Slug "tenant1";
    }
}

server {
    listen 80;
    server_name store1.tenant1.vendix.localhost;
    
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Tenant-Type "store_ecommerce";
        proxy_set_header X-Organization-Slug "tenant1";
        proxy_set_header X-Store-Slug "store1";
    }
}
```

Enable the configuration:
```bash
# Create symbolic link to enable site
sudo ln -s /etc/nginx/sites-available/vendix /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

## 4. Docker Compose Modifications

If you're using Docker for development, you'll need to modify your `docker-compose.yml` to work with the new setup:

```yaml
version: '3.8'

services:
  db:
    image: postgres:13
    container_name: vendix_db
    restart: always
    env_file:
      - .env
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    networks:
      - vendix_net

  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    container_name: vendix_backend
    restart: always
    env_file:
      - ./apps/backend/.env
    ports:
      - "3000:3000"  # Expose for direct access
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
      - "4200:4200"  # Expose for direct access
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

## 5. Backend Code Modifications

Update the domain resolution service to handle development domains properly:

```typescript
// apps/backend/src/common/services/domain-resolution.service.ts

@Injectable()
export class DomainResolutionService {
  constructor(private prisma: PrismaService) {}

  async resolveDomain(hostname: string): Promise<DomainConfig> {
    // Handle development domains
    if (hostname.endsWith('.localhost')) {
      return this.resolveDevelopmentDomain(hostname);
    }

    // Production domain resolution
    const domainSetting = await this.prisma.domain_settings.findFirst({
      where: { hostname },
    });

    if (!domainSetting) {
      throw new NotFoundException('Domain configuration not found');
    }

    return this.parseDomainConfig(domainSetting);
  }

  private resolveDevelopmentDomain(hostname: string): DomainConfig {
    // Special handling for development domains
    const parts = hostname.split('.');
    
    // vendix.localhost
    if (hostname === 'vendix.localhost') {
      return {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
      };
    }
    
    // admin.vendix.localhost
    if (hostname === 'admin.vendix.localhost') {
      return {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_ADMIN,
        isVendixDomain: true,
      };
    }
    
    // Organization domains (e.g., mordoc.localhost)
    if (parts.length === 2 && parts[1] === 'localhost') {
      return {
        domainType: DomainType.ORGANIZATION_ROOT,
        environment: AppEnvironment.ORG_LANDING,
        organizationSlug: parts[0],
        isVendixDomain: false,
      };
    }
    
    // Organization admin domains (e.g., app.mordoc.localhost)
    if (parts.length === 3 && parts[0] === 'app') {
      return {
        domainType: DomainType.ORGANIZATION_SUBDOMAIN,
        environment: AppEnvironment.ORG_ADMIN,
        organizationSlug: parts[1],
        isVendixDomain: false,
      };
    }
    
    // Store domains (e.g., luda.mordoc.localhost)
    if (parts.length === 3 && parts[2] === 'localhost') {
      return {
        domainType: DomainType.STORE_SUBDOMAIN,
        environment: AppEnvironment.STORE_ECOMMERCE,
        organizationSlug: parts[1],
        storeSlug: parts[0],
        isVendixDomain: false,
      };
    }
    
    // Custom store domains (e.g., luda.localhost)
    if (parts.length === 2 && parts[1] === 'localhost') {
      return {
        domainType: DomainType.STORE_CUSTOM,
        environment: AppEnvironment.STORE_ECOMMERCE,
        storeSlug: parts[0],
        isVendixDomain: false,
      };
    }
    
    // Default fallback
    return {
      domainType: DomainType.VENDIX_CORE,
      environment: AppEnvironment.VENDIX_LANDING,
      isVendixDomain: true,
    };
  }

  private parseDomainConfig(domainSetting: any): DomainConfig {
    // Implementation for parsing domain configuration from database
    // This should match your existing implementation
  }
}
```

## 6. Frontend Code Modifications

Update the domain detector service and environment files:

```typescript
// apps/frontend/src/app/core/services/domain-detector.service.ts

@Injectable({
  providedIn: 'root'
})
export class DomainDetectorService {
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  detectDomain(): DomainConfig {
    // Server-side detection not possible, return default
    if (isPlatformServer(this.platformId)) {
      return {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
      };
    }

    // Client-side detection
    const hostname = window.location.hostname;
    
    // Handle development domains
    if (hostname.endsWith('.localhost')) {
      return this.detectDevelopmentDomain(hostname);
    }

    // Production domain detection would go here
    // For now, we'll return a default configuration
    return {
      domainType: DomainType.VENDIX_CORE,
      environment: AppEnvironment.VENDIX_LANDING,
      isVendixDomain: true,
    };
  }

  private detectDevelopmentDomain(hostname: string): DomainConfig {
    // Same logic as backend for consistency
    const parts = hostname.split('.');
    
    // vendix.localhost
    if (hostname === 'vendix.localhost') {
      return {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
      };
    }
    
    // admin.vendix.localhost
    if (hostname === 'admin.vendix.localhost') {
      return {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_ADMIN,
        isVendixDomain: true,
      };
    }
    
    // Organization domains (e.g., mordoc.localhost)
    if (parts.length === 2 && parts[1] === 'localhost') {
      return {
        domainType: DomainType.ORGANIZATION_ROOT,
        environment: AppEnvironment.ORG_LANDING,
        organizationSlug: parts[0],
        isVendixDomain: false,
      };
    }
    
    // Organization admin domains (e.g., app.mordoc.localhost)
    if (parts.length === 3 && parts[0] === 'app') {
      return {
        domainType: DomainType.ORGANIZATION_SUBDOMAIN,
        environment: AppEnvironment.ORG_ADMIN,
        organizationSlug: parts[1],
        isVendixDomain: false,
      };
    }
    
    // Store domains (e.g., luda.mordoc.localhost)
    if (parts.length === 3 && parts[2] === 'localhost') {
      return {
        domainType: DomainType.STORE_SUBDOMAIN,
        environment: AppEnvironment.STORE_ECOMMERCE,
        organizationSlug: parts[1],
        storeSlug: parts[0],
        isVendixDomain: false,
      };
    }
    
    // Custom store domains (e.g., luda.localhost)
    if (parts.length === 2 && parts[1] === 'localhost') {
      return {
        domainType: DomainType.STORE_CUSTOM,
        environment: AppEnvironment.STORE_ECOMMERCE,
        storeSlug: parts[0],
        isVendixDomain: false,
      };
    }
    
    // Default fallback
    return {
      domainType: DomainType.VENDIX_CORE,
      environment: AppEnvironment.VENDIX_LANDING,
      isVendixDomain: true,
    };
  }
}
```

Update environment files:

```typescript
// apps/frontend/src/environments/environment.ts

export const environment = {
  production: false,
  apiUrl: 'http://api.vendix.localhost', // Updated to use virtual host
  vendixDomain: 'vendix.localhost', // Updated to use virtual host

  // Debug settings
  debugDomainDetection: true,
  debugThemeApplication: true,
  debugAuthFlow: true,
};
```

## 7. Development Automation Scripts

Create a script to automate the setup process:

### setup-virtual-hosts.sh
```bash
#!/bin/bash

# Script to set up virtual hosts for Vendix development

echo "Setting up virtual hosts for Vendix development..."

# Check if running on Linux or macOS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    HOSTS_FILE="/etc/hosts"
    SUDO="sudo"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    HOSTS_FILE="/etc/hosts"
    SUDO="sudo"
else
    echo "Unsupported operating system. Please manually configure your hosts file."
    exit 1
fi

# Check if script is run with sufficient privileges
if [ "$EUID" -ne 0 ]; then
    echo "This script requires sudo privileges to modify the hosts file."
    echo "Please enter your password when prompted."
fi

# Backup original hosts file
echo "Backing up original hosts file..."
$SUDO cp $HOSTS_FILE $HOSTS_FILE.backup.$(date +%s)

# Add Vendix virtual hosts to hosts file
echo "Adding virtual hosts to $HOSTS_FILE..."

$SUDO tee -a $HOSTS_FILE > /dev/null <<EOT

# Vendix Virtual Hosts - Added $(date)
127.0.0.1 vendix.localhost
127.0.0.1 admin.vendix.localhost
127.0.0.1 api.vendix.localhost
127.0.0.1 mordoc.localhost
127.0.0.1 app.mordoc.localhost
127.0.0.1 luda.mordoc.localhost
127.0.0.1 admin.luda.mordoc.localhost
127.0.0.1 luda.localhost
127.0.0.1 admin.luda.localhost
127.0.0.1 tenant1.vendix.localhost
127.0.0.1 store1.tenant1.vendix.localhost
# End Vendix Virtual Hosts
EOT

echo "Virtual hosts added to $HOSTS_FILE"

# Check if Nginx is installed
if command -v nginx &> /dev/null; then
    echo "Nginx detected. Setting up configuration..."
    
    # Create Nginx configuration directory if it doesn't exist
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        NGINX_SITES_DIR="/etc/nginx/sites-available"
        NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        NGINX_SITES_DIR="/usr/local/etc/nginx/servers"
        NGINX_ENABLED_DIR="/usr/local/etc/nginx/servers"
    fi
    
    # Create the Vendix Nginx configuration
    echo "Creating Nginx configuration..."
    
    # This would be where you'd copy or create the nginx.conf file
    # For now, we'll just notify the user
    echo "Please create the Nginx configuration file at $NGINX_SITES_DIR/vendix"
    echo "Then enable it with: sudo ln -s $NGINX_SITES_DIR/vendix $NGINX_ENABLED_DIR/"
    
    # Test Nginx configuration
    echo "Testing Nginx configuration..."
    $SUDO nginx -t
    
    # Restart Nginx
    echo "Restarting Nginx..."
    $SUDO systemctl restart nginx
else
    echo "Nginx not detected. Please install Nginx if you want to use it for virtual host routing."
fi

echo "Virtual host setup complete!"
echo ""
echo "You can now access the following domains:"
echo "  http://vendix.localhost - Main landing page"
echo "  http://admin.vendix.localhost - Super admin panel"
echo "  http://api.vendix.localhost - API endpoint"
echo "  http://mordoc.localhost - Organization landing page"
echo "  http://app.mordoc.localhost - Organization admin panel"
echo "  http://luda.mordoc.localhost - Store e-commerce frontend"
echo "  http://admin.luda.mordoc.localhost - Store admin panel"
echo "  http://luda.localhost - Custom store domain"
echo "  http://admin.luda.localhost - Custom store admin domain"
echo ""
echo "Note: Make sure your frontend is running on port 4200 and backend on port 3000"
</script>
```

### test-domains.sh
```bash
#!/bin/bash

# Script to test domain resolutions

echo "Testing Vendix virtual host resolutions..."

DOMAINS=(
    "vendix.localhost"
    "admin.vendix.localhost"
    "api.vendix.localhost"
    "mordoc.localhost"
    "app.mordoc.localhost"
    "luda.mordoc.localhost"
    "admin.luda.mordoc.localhost"
    "luda.localhost"
    "admin.luda.localhost"
    "tenant1.vendix.localhost"
    "store1.tenant1.vendix.localhost"
)

for domain in "${DOMAINS[@]}"; do
    echo "Testing $domain..."
    
    # Test DNS resolution
    if nslookup $domain &> /dev/null; then
        echo "  DNS resolution: ✓ Success"
    else
        echo "  DNS resolution: ✗ Failed"
    fi
    
    # Test HTTP access
    if curl -s --head http://$domain &> /dev/null; then
        echo "  HTTP access: ✓ Success"
    else
        echo "  HTTP access: ✗ Failed"
    fi
    
    echo ""
done

echo "Domain testing complete!"
```

## 8. Starting the Development Environment

With the virtual hosts configured, start your development environment:

```bash
# Start backend
cd apps/backend
npm run start:dev

# In a new terminal, start frontend
cd apps/frontend
npm run start

# In a new terminal, start nginx (if using)
sudo systemctl start nginx
```

Or with Docker:
```bash
# Build and start all services
docker-compose up --build
```

You should now be able to access all the configured domains in your browser and test the multitenant functionality of your application.

## 9. Troubleshooting

If you encounter issues:

1. **Domains not resolving**: Check that the entries were added to your hosts file correctly
2. **Nginx configuration errors**: Run `sudo nginx -t` to test the configuration
3. **Services not accessible**: Ensure your frontend is running on port 4200 and backend on port 3000
4. **Permission errors**: Make sure you're running setup scripts with appropriate privileges

For Docker setups, check that the containers are running and ports are correctly mapped.