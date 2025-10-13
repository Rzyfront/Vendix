# Contexto de la App Vendix

## Infraestructura
- Corre en Docker con contenedores: `vendix_postgres` (PostgreSQL), `vendix_backend` (NestJS), `vendix_frontend` (Angular).
- Modo desarrollo con watch hot reload activado.
- Nginx para configuración de subdominios y SSL.

## Documentación
- Carpetas `doc/` en cada proyecto (backend, frontend) con documentación específica, incluyendo ADRs, guías de arquitectura y archivos .http para pruebas de API.

## Tecnologías
- Backend: NestJS corriendo en Node.js con Prisma ORM.
- Prisma: ORM para modelado de datos, migraciones, generación automática de tipos y consultas eficientes. Configuración centralizada en `prisma/schema.prisma` y uso de clientes generados para acceso seguro a la base de datos.
- Base de datos: PostgreSQL con migraciones y seed data.
- Lenguaje: TypeScript en todo el proyecto.

## Convenciones de Código
- Funciones: CamelCase (ej. `getUserData`).
- Variables: snake_case (ej. `user_name`).
- Clases: PascalCase (ej. `UserService`).

## Arquitectura
- Modular y reutilizable.
- Multi-tenant: Soporte para dominios dinámicos, organizaciones, tiendas y usuarios.
- Herramientas específicas se crean reutilizables en carpetas `utils/`.

## Backend
- Se maneja authenticacion globales en JWT desde el app.module.ts y se expluyen rutas publicas con @Public
- Se manejan contextos automaticos globales en prisma desde el app.module.ts
- Se registrar permisos para rutas granularmente con @Permissions

## Front
- Se maneja un punto e entrada que resuelve el dominio para configurar y decidir que vista mostrar.
- Se setea la configuracion de branding resuelta por el dominio.
- Se usa tokens para mantener un estandar de estilos generales en la app.
- Se usan componentes reutilizables para la construccion de vistar y componentes.
- Se usa un gestor de estados global centralizado.
- Se usa un guard para direccionar a layout de aplicacion especificas por rol.