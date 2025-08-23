# Vendix Backend - Configuración de Seguridad y Emails

## 🔐 Configuración de Seguridad

### Variables de Entorno Requeridas
```env
# JWT Configuration
JWT_SECRET=tu-clave-secreta-muy-segura-aqui
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Database
DATABASE_URL=postgresql://usuario:password@localhost:5432/vendix_db

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-password-app
SMTP_FROM=noreply@tudominio.com

# App Configuration
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:4200
```

### Refresh Tokens Seguros por Dispositivo

#### Características Implementadas
- **Device Fingerprinting**: Hash único SHA256 por dispositivo
- **IP Address Tracking**: Monitoreo de ubicación de acceso
- **Browser Detection**: Chrome, Firefox, Safari, Edge, Opera
- **OS Detection**: Windows, macOS, Linux, Android, iOS
- **Auto Revocation**: Tokens sospechosos se invalidan automáticamente
- **Frequency Control**: Máximo 1 refresh cada 30 segundos

#### Flujo de Autenticación
```mermaid
sequenceDiagram
    participant C as Cliente
    participant S as Servidor
    participant DB as Base de Datos
    
    C->>S: POST /auth/login
    S->>DB: Validar usuario
    DB-->>S: Usuario válido
    S->>DB: Crear refresh token
    S-->>C: JWT + Refresh Token
    
    Note over C,S: JWT expira en 15 minutos
    
    C->>S: POST /auth/refresh
    S->>DB: Validar refresh token
    S->>DB: Crear nuevo refresh token
    S->>DB: Invalidar token anterior
    S-->>C: Nuevo JWT + Refresh Token
```

#### Tabla de Refresh Tokens
```sql
CREATE TABLE refresh_tokens (
    id SERIAL PRIMARY KEY,
    token VARCHAR(255) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    device_fingerprint VARCHAR(64) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    browser_name VARCHAR(50),
    browser_version VARCHAR(20),
    os_name VARCHAR(50),
    os_version VARCHAR(20),
    is_revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    last_used_at TIMESTAMP
);
```

### Configuración de Seguridad HTTP

#### Headers de Seguridad
```typescript
// main.ts
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.vendix.com"],
      fontSrc: ["'self'", "https://fonts.googleapis.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
```

#### CORS Configuration
```typescript
app.enableCors({
  origin: [
    'http://localhost:4200',
    'https://app.vendix.com',
    'https://admin.vendix.com',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
});
```

### Rate Limiting
```typescript
// Configuración de rate limiting
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60, // 1 minuto
      limit: 10, // 10 requests por minuto
    }),
  ],
})
export class AppModule {}
```

---

## 📧 Sistema de Emails

### Configuración SMTP

#### Gmail
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-password-app  # Usar App Password, no la contraseña normal
SMTP_FROM=noreply@tudominio.com
```

#### Outlook/Hotmail
```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-email@outlook.com
SMTP_PASS=tu-password
SMTP_FROM=noreply@tudominio.com
```

#### SendGrid
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=tu-sendgrid-api-key
SMTP_FROM=noreply@tudominio.com
```

### Plantillas de Email

#### Verificación de Email
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Verificar Email - Vendix</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 10px; }
        .header { text-align: center; color: #333; }
        .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 14px; margin-top: 30px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>¡Bienvenido a Vendix!</h1>
            <p>Verifica tu email para comenzar</p>
        </div>
        
        <p>Hola {{firstName}},</p>
        
        <p>Gracias por registrarte en Vendix. Para completar tu registro, haz clic en el botón de abajo:</p>
        
        <div style="text-align: center;">
            <a href="{{verificationUrl}}" class="button">Verificar Email</a>
        </div>
        
        <p>Si no puedes hacer clic en el botón, copia y pega este enlace en tu navegador:</p>
        <p><a href="{{verificationUrl}}">{{verificationUrl}}</a></p>
        
        <p>Este enlace expirará en 24 horas.</p>
        
        <div class="footer">
            <p>Si no creaste esta cuenta, puedes ignorar este email.</p>
            <p>&copy; 2025 Vendix. Todos los derechos reservados.</p>
        </div>
    </div>
</body>
</html>
```

#### Reset de Contraseña
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Restablecer Contraseña - Vendix</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 10px; }
        .header { text-align: center; color: #333; }
        .button { display: inline-block; padding: 12px 24px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 14px; margin-top: 30px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Restablecer Contraseña</h1>
        </div>
        
        <p>Hola {{firstName}},</p>
        
        <p>Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón de abajo para crear una nueva contraseña:</p>
        
        <div style="text-align: center;">
            <a href="{{resetUrl}}" class="button">Restablecer Contraseña</a>
        </div>
        
        <p>Si no puedes hacer clic en el botón, copia y pega este enlace en tu navegador:</p>
        <p><a href="{{resetUrl}}">{{resetUrl}}</a></p>
        
        <p>Este enlace expirará en 1 hora.</p>
        
        <div class="footer">
            <p>Si no solicitaste restablecer tu contraseña, puedes ignorar este email.</p>
            <p>&copy; 2025 Vendix. Todos los derechos reservados.</p>
        </div>
    </div>
</body>
</html>
```

### Testing de Emails

#### Prueba de Configuración SMTP
```bash
# Endpoint para probar configuración
curl -X POST http://localhost:3000/api/email/test \
  -H "Content-Type: application/json" \
  -d '{"to": "test@example.com", "subject": "Test Email", "text": "Email de prueba"}'
```

#### Verificar Logs
```bash
# Logs de emails enviados
tail -f logs/email.log

# Logs de errores
tail -f logs/error.log
```

---

## 🔍 Monitoreo y Logs

### Configuración de Logs
```typescript
// logger.config.ts
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

export const loggerConfig = WinstonModule.createLogger({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ms }) => {
          return `${timestamp} [${level}] ${message} ${ms}`;
        }),
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    }),
  ],
});
```

### Métricas de Seguridad
```typescript
// Interceptor para logs de seguridad
@Injectable()
export class SecurityLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip, headers } = request;
    
    // Log de request
    console.log(`[SECURITY] ${method} ${url} from ${ip}`);
    
    return next.handle().pipe(
      tap(() => {
        // Log de response exitoso
        console.log(`[SECURITY] ${method} ${url} - SUCCESS`);
      }),
      catchError((error) => {
        // Log de error
        console.error(`[SECURITY] ${method} ${url} - ERROR:`, error.message);
        throw error;
      }),
    );
  }
}
```

---

## 🛡️ Checklist de Seguridad

### ✅ Implementado
- [x] JWT con refresh tokens
- [x] Device fingerprinting
- [x] Rate limiting
- [x] CORS configurado
- [x] Headers de seguridad (Helmet)
- [x] Validación de entrada
- [x] Encriptación de contraseñas
- [x] Logs de seguridad
- [x] Verificación de email
- [x] Reset de contraseña seguro

### 🔄 Recomendaciones Adicionales
- [ ] Implementar 2FA (Two-Factor Authentication)
- [ ] Configurar WAF (Web Application Firewall)
- [ ] Implementar IP whitelisting
- [ ] Configurar SSL/TLS certificates
- [ ] Implementar session management avanzado
- [ ] Configurar backup automático de base de datos
- [ ] Implementar monitoring de seguridad en tiempo real

---

## 📞 Soporte de Seguridad

### Reportar Vulnerabilidades
- **Email**: security@vendix.com
- **Proceso**: Responsible disclosure
- **Tiempo de respuesta**: 24-48 horas

### Contacto de Emergencia
- **Email**: emergency@vendix.com
- **Teléfono**: +1-XXX-XXX-XXXX
- **Disponibilidad**: 24/7 para incidentes críticos
