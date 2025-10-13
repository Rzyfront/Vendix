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