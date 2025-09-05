# Servicio JWT Token System - Vendix

## 📋 Descripción General

El servicio **JWT Token System** es el **núcleo de autenticación y autorización** del sistema Vendix, implementando un sistema completo de tokens JWT con refresh tokens, gestión de sesiones y device fingerprinting. Este servicio es crítico porque proporciona autenticación stateless con seguridad stateful.

## 🎯 Función Principal

### ¿Qué hace el servicio?
- **Autenticación JWT completa**: Access + Refresh tokens
- **Gestión automática de expiración**: Renovación transparente de tokens
- **Control de sesiones**: Tracking completo por dispositivo
- **Seguridad avanzada**: Device fingerprinting y validación de sesiones
- **Logout inteligente**: Revocación selectiva o completa de sesiones
- **Auditoría completa**: Registro de todas las actividades de tokens

## 🏗️ Arquitectura del Sistema JWT

### Diseño del Sistema
- **Doble token**: Access (corto) + Refresh (largo)
- **Renovación automática**: Transparente para el usuario
- **Sesiones stateful**: Control de dispositivos activos
- **Validación híbrida**: Stateless + Stateful
- **Seguridad multicapa**: Rate limiting + Device tracking

### Estructura del Sistema
```
Cliente solicita acceso
    ↓
Login con credenciales
    ↓
Generación de tokens JWT
├── Access Token (10h)
│   ├── Stateless validation
│   ├── Contiene permisos
│   └── Expira en 10 horas
└── Refresh Token (7 días)
    ├── Stateful validation
    ├── Almacenado en BD
    └── Device fingerprinting
    ↓
Cliente usa Access Token
    ↓
Access Token expira
    ↓
Cliente usa Refresh Token
    ↓
Validación completa
├── Token no revocado
├── Device fingerprint válido
├── IP tracking opcional
└── Sesión activa
    ↓
Generación de nuevos tokens
    ↓
Continuación transparente
```

## 🔄 Flujo Completo de Tokens

### 1. Generación Inicial de Tokens
```typescript
// En AuthService.generateTokens()
async generateTokens(user: any) {
  // 1. Payload del token
  const payload = {
    sub: user.id,
    email: user.email,
    roles: user.user_roles?.map(ur => ur.roles?.name) || [],
    permissions: this.extractPermissions(user),
    iat: Math.floor(Date.now() / 1000)
  };

  // 2. Access Token (largo plazo - 10 horas)
  const accessToken = this.jwtService.sign(payload, {
    secret: this.configService.get('JWT_ACCESS_SECRET'),
    expiresIn: this.configService.get('JWT_EXPIRES_IN', '10h')  // ✅ 10 HORAS
  });

  // 3. Refresh Token (largo plazo)
  const refreshPayload = {
    sub: user.id,
    email: user.email,
    type: 'refresh',
    iat: Math.floor(Date.now() / 1000)
  };

  const refreshToken = this.jwtService.sign(refreshPayload, {
    secret: this.configService.get('JWT_REFRESH_SECRET'),
    expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d')
  });

  return { access_token: accessToken, refresh_token: refreshToken };
}
```

### 2. Almacenamiento de Refresh Token
```typescript
// En AuthService.createUserSession()
async createUserSession(userId: number, refreshToken: string, clientInfo: ClientInfo) {
  const hashedToken = await bcrypt.hash(refreshToken, 12);
  const deviceFingerprint = this.generateDeviceFingerprint(clientInfo);

  await this.prismaService.refresh_tokens.create({
    data: {
      user_id: userId,
      token_hash: hashedToken,
      device_fingerprint: deviceFingerprint,
      ip_address: clientInfo.ipAddress,
      user_agent: clientInfo.userAgent,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
      created_at: new Date()
    }
  });
}
```

### 3. Validación de Access Token
```typescript
// Middleware JwtAuthGuard
async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest();
  const token = this.extractTokenFromHeader(request);

  if (!token) {
    throw new UnauthorizedException('Token no proporcionado');
  }

  try {
    // Verificar token JWT
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.configService.get('JWT_ACCESS_SECRET')
    });

    // Verificar sesión activa (stateful validation)
    await this.sessionValidationService.validateSession(
      payload.sub,
      this.generateDeviceFingerprint(request)
    );

    request.user = payload;
    return true;

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedException('Token expirado');
    }
    throw new UnauthorizedException('Token inválido');
  }
}
```

### 4. Renovación de Tokens (Refresh)
```typescript
// En AuthService.refreshToken()
async refreshToken(refreshTokenDto: RefreshTokenDto, clientInfo: ClientInfo) {
  const { refresh_token } = refreshTokenDto;

  // 1. Verificar formato del refresh token
  const payload = this.jwtService.verify(refresh_token, {
    secret: this.configService.get('JWT_REFRESH_SECRET')
  });

  // 2. Buscar token en BD
  const storedToken = await this.prismaService.refresh_tokens.findFirst({
    where: {
      token_hash: await bcrypt.hash(refresh_token, 12),
      user_id: payload.sub,
      revoked: false,
      expires_at: { gt: new Date() }
    }
  });

  if (!storedToken) {
    throw new UnauthorizedException('Refresh token inválido o expirado');
  }

  // 3. Validar device fingerprint
  const currentFingerprint = this.generateDeviceFingerprint(clientInfo);
  if (storedToken.device_fingerprint !== currentFingerprint) {
    throw new UnauthorizedException('Sesión inválida - dispositivo no coincide');
  }

  // 4. Generar nuevos tokens
  const user = await this.getUserWithRoles(payload.sub);
  const newTokens = await this.generateTokens(user);

  // 5. Actualizar BD con nuevo refresh token
  await this.updateRefreshToken(storedToken.id, newTokens.refresh_token, clientInfo);

  return newTokens;
}
```

## 🛡️ Medidas de Seguridad Implementadas

### Device Fingerprinting
```typescript
// Generación de huella digital del dispositivo
generateDeviceFingerprint(clientInfo: ClientInfo): string {
  const components = [
    clientInfo.userAgent || 'Unknown',
    clientInfo.ipAddress || '127.0.0.1',
    clientInfo.screenResolution || 'Unknown',
    clientInfo.timezone || 'Unknown'
  ];

  return crypto.createHash('sha256')
    .update(components.join('|'))
    .digest('hex');
}
```

### Rate Limiting
```typescript
// Middleware RateLimitGuard
async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest();
  const clientIP = request.ip || request.connection.remoteAddress;

  const attempts = this.attempts.get(clientIP) || { count: 0, resetTime: Date.now() };

  // Reset counter if window expired
  if (Date.now() > attempts.resetTime) {
    attempts.count = 0;
    attempts.resetTime = Date.now() + this.windowMs;
  }

  attempts.count++;
  this.attempts.set(clientIP, attempts);

  if (attempts.count > this.maxRequests) {
    throw new HttpException(
      'Too many requests from this IP, please try again later.',
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  return true;
}
```

### Logout y Revocación
```typescript
// Logout completo
async logout(userId: number, allSessions: boolean = false, refreshToken?: string) {
  if (allSessions) {
    // Revocar todas las sesiones
    await this.prismaService.refresh_tokens.updateMany({
      where: { user_id: userId },
      data: {
        revoked: true,
        revoked_at: new Date()
      }
    });
  } else if (refreshToken) {
    // Revocar sesión específica
    const tokenHash = await bcrypt.hash(refreshToken, 12);
    await this.prismaService.refresh_tokens.updateMany({
      where: {
        token_hash: tokenHash,
        user_id: userId
      },
      data: {
        revoked: true,
        revoked_at: new Date()
      }
    });
  }
}
```

## 📊 Endpoints del Sistema JWT

### POST /api/auth/login
**Función**: Autenticación inicial y generación de tokens
**Parámetros**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "organizationSlug": "org-slug"
}
```
**Respuesta**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { /* datos del usuario */ }
}
```

### POST /api/auth/refresh
**Función**: Renovación automática de tokens
**Parámetros**:
```json
{
  "refresh_token": "refresh_token_aqui"
}
```

### POST /api/auth/logout
**Función**: Revocación de sesiones
**Parámetros**:
```json
{
  "refresh_token": "token_especifico", // opcional
  "all_sessions": true // opcional
}
```

### GET /api/auth/sessions
**Función**: Lista de sesiones activas
**Respuesta**:
```json
{
  "data": [
    {
      "id": 1,
      "device": {
        "browser": "Chrome",
        "os": "Linux",
        "type": "Desktop"
      },
      "ipAddress": "192.168.1.100",
      "lastUsed": "2025-09-05T15:30:00Z",
      "isCurrentSession": true
    }
  ]
}
```

## ⚙️ Configuración del Sistema

### Variables de Entorno
```env
# JWT Configuration
JWT_ACCESS_SECRET=your_access_secret_key
JWT_REFRESH_SECRET=your_refresh_secret_key
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=5

# Security
BCRYPT_SALT_ROUNDS=12
SESSION_VALIDATION_ENABLED=true
```

### Configuración de Base de Datos
```sql
-- Tabla refresh_tokens
CREATE TABLE refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  device_fingerprint VARCHAR(255) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_fingerprint ON refresh_tokens(device_fingerprint);
CREATE INDEX idx_refresh_tokens_revoked ON refresh_tokens(revoked);
```

## 🔍 Casos de Uso y Flujos

### Caso 1: Login Normal
1. Usuario envía credenciales
2. Servidor valida credenciales
3. Genera access + refresh tokens
4. Almacena refresh token en BD
5. Retorna tokens al cliente

### Caso 2: Token Expirado
1. Cliente intenta usar access token expirado
2. Servidor responde 401 "Token expirado"
3. Cliente automáticamente solicita refresh
4. Servidor valida refresh token en BD
5. Genera nuevos tokens
6. Cliente reintenta request original

### Caso 3: Logout
1. Usuario solicita logout
2. Servidor marca tokens como revocados
3. Cliente elimina tokens locales
4. Futuros requests son rechazados

### Caso 4: Sesión Robada
1. Refresh token comprometido
2. Device fingerprint no coincide
3. Servidor rechaza renovación
4. Usuario forzado a re-login

## 📈 Métricas y Monitoreo

### KPIs de Seguridad
- **Tasa de renovación exitosa**: >95%
- **Tokens revocados por día**: Monitoreo
- **Sesiones activas promedio**: Por usuario
- **Tiempo de respuesta**: <500ms promedio

### Alertas de Seguridad
- **Device fingerprint mismatch**: Alerta inmediata
- **Múltiples sesiones simultáneas**: Warning
- **Rate limiting activado**: Notificación
- **Tokens expirados masivamente**: Investigación

### Logs de Auditoría
```json
{
  "action": "TOKEN_REFRESH",
  "user_id": 123,
  "ip_address": "192.168.1.100",
  "device_fingerprint": "abc123...",
  "user_agent": "Mozilla/5.0...",
  "timestamp": "2025-09-05T15:30:00Z"
}
```

## 🚀 Próximas Mejoras

### Funcionalidades Planificadas
- [ ] **JWT con JWE**: Encriptación de payloads
- [ ] **Token rotation avanzado**: Rotación automática
- [ ] **Geolocalización**: Tracking de ubicación
- [ ] **MFA integration**: Autenticación de dos factores
- [ ] **Session isolation**: Contenedores de sesión
- [ ] **Advanced analytics**: Machine learning para detección de anomalías

### Mejoras de Performance
- [ ] **Redis caching**: Para validación de sesiones
- [ ] **Token blacklisting**: Lista negra distribuida
- [ ] **CDN integration**: Para distribución global
- [ ] **Load balancing**: Sesiones sticky

---

**📅 Última actualización**: Septiembre 5, 2025
**👨‍💻 Desarrollado por**: Vendix Security Team
**📊 Estado**: ✅ **PRODUCCIÓN LISTO**</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/JWT Token System/JWTTokenSystemProcess.md
