# Standardized Response Service

Este servicio proporciona una forma consistente de formatear las respuestas de API en toda la aplicación.

## Instalación

El `ResponseModule` se puede importar en cualquier módulo que lo necesite:

```typescript
import { ResponseModule } from '../common/responses/response.module';

@Module({
  imports: [ResponseModule],
  // ...
})
export class YourModule {}
```

Luego inyecta el `ResponseService` en tu controlador:

```typescript
import { ResponseService } from '../common/responses/response.service';

@Controller('your-controller')
export class YourController {
  constructor(
    private readonly responseService: ResponseService,
  ) {}
}
```

## Uso

### Respuesta de Éxito
```typescript
return this.responseService.success(data, 'Operación completada exitosamente');
```

### Respuesta de Recurso Creado
```typescript
return this.responseService.created(newUser, 'Usuario creado exitosamente');
```

### Respuesta de Recurso Actualizado
```typescript
return this.responseService.updated(updatedUser, 'Usuario actualizado exitosamente');
```

### Respuesta de Recurso Eliminado
```typescript
return this.responseService.deleted('Usuario eliminado exitosamente');
```

### Respuesta Paginada
```typescript
return this.responseService.paginated(
  users,           // Array de datos
  totalCount,      // Total de elementos
  page,            // Página actual
  limit,           // Límite por página
  'Usuarios obtenidos exitosamente' // Mensaje opcional
);
```

### Respuesta Sin Contenido
```typescript
return this.responseService.noContent('Operación completada');
```

### Respuesta de Error
```typescript
return this.responseService.error(
  'Error al procesar la solicitud',
  'Detalles del error',
  400 // Código de estado HTTP (opcional)
);
```

## Formatos de Respuesta

### Formato de Respuesta Exitosa
```json
{
  "success": true,
  "message": "Operación completada exitosamente",
  "data": {
    "id": 1,
    "name": "John Doe"
  }
}
```

### Formato de Respuesta Exitosa con Metadata
```json
{
  "success": true,
  "message": "Datos obtenidos",
  "data": { ... },
  "meta": {
    "version": "1.0",
    "cached": true
  }
}
```

### Formato de Respuesta Paginada
```json
{
  "success": true,
  "message": "Usuarios obtenidos exitosamente",
  "data": [
    { "id": 1, "name": "User 1" },
    { "id": 2, "name": "User 2" }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### Formato de Respuesta de Error
```json
{
  "success": false,
  "message": "Error al procesar la solicitud",
  "error": "Detalles específicos del error",
  "statusCode": 400,
  "timestamp": "2025-10-05T03:30:00.000Z"
}
```

### Formato de Respuesta de Error con Detalles
```json
{
  "success": false,
  "message": "Validación fallida",
  "error": {
    "email": "El email no es válido",
    "password": "La contraseña debe tener al menos 8 caracteres"
  },
  "statusCode": 422,
  "timestamp": "2025-10-05T03:30:00.000Z"
}
```

## Interfaces TypeScript

### SuccessResponse
```typescript
interface SuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  meta?: Record<string, any>;
}
```

### ErrorResponse
```typescript
interface ErrorResponse {
  success: false;
  message: string;
  error: string | Record<string, any>;
  statusCode?: number;
  timestamp?: string;
}
```

### PaginatedResponse
```typescript
interface PaginatedResponse<T> {
  success: true;
  message: string;
  data: T[];
  meta: PaginationMeta;
}

interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
```

## Ejemplo Completo

```typescript
import { Controller, Get, Post, Body, Param, Delete, Query } from '@nestjs/common';
import { ResponseService } from '../common/responses/response.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  async findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    const { users, total } = await this.usersService.findAll(page, limit);
    
    return this.responseService.paginated(
      users,
      total,
      page,
      limit,
      'Usuarios obtenidos exitosamente'
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const user = await this.usersService.findOne(+id);
    
    return this.responseService.success(
      user,
      'Usuario encontrado'
    );
  }

  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.usersService.create(createUserDto);
    
    return this.responseService.created(
      user,
      'Usuario creado exitosamente'
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.usersService.remove(+id);
    
    return this.responseService.deleted(
      'Usuario eliminado exitosamente'
    );
  }
}
```

## Mejores Prácticas

1. **Usa mensajes descriptivos**: Los mensajes deben ser claros y en español para el frontend.

2. **Incluye metadata cuando sea relevante**: Usa el parámetro `meta` para información adicional como versión, caché, etc.

3. **Respuestas paginadas**: Siempre usa `paginated()` para listas largas de datos.

4. **Errores detallados**: Cuando sea posible, proporciona detalles específicos del error en formato de objeto.

5. **Consistencia**: Usa siempre los métodos del servicio en lugar de crear respuestas manualmente.

{
  "success": false,
  "message": "Error message",
  "data": null,
  "error": {
    "details": {}
  },
  "timestamp": "2023-01-01T00:00:00.000Z",
  "path": "/api/resource"
}
```