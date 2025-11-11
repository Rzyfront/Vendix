# Vendix - Docker Compose Setup

Este proyecto utiliza Docker Compose para levantar el frontend (Angular), backend (NestJS) y la base de datos (Postgres) en contenedores separados, optimizados para producción.

## 📚 Documentación
- **[Guía de Desarrollo](README-dev.md)** - Flujo recomendado para desarrollo diario
- **[Documentación Técnica](apps/backend/doc/)** - Detalles técnicos del sistema

## Estructura de carpetas
- `/vendix_app` → Frontend Angular
- `/vendix_backend` → Backend NestJS (usa Prisma)

## Requisitos previos
- [Docker](https://www.docker.com/products/docker-desktop) y [Docker Compose](https://docs.docker.com/compose/) instalados


## Instalación y configuración para nuevos desarrolladores

1. **Clona el repositorio:**
	```bash
	git clone <URL_DEL_REPO>
	cd <NOMBRE_DEL_REPO>
	```

2. **Instala Docker Desktop:**
	- Descarga e instala Docker Desktop desde [docker.com](https://www.docker.com/products/docker-desktop).
	- Asegúrate de que Docker esté corriendo antes de continuar.

3. **Configura el archivo de entorno:**
	- Copia el archivo `.env.example` de `vendix_backend` y renómbralo a `.env`.
	- Ajusta las variables si es necesario (usuario, contraseña, etc).
	```bash
	cp vendix_backend/.env.example vendix_backend/.env
	# Edita vendix_backend/.env si lo necesitas
	```

4. **Levanta el entorno de desarrollo:**
	```bash
	docker compose up -d --build
	```
	Esto levantará:
	- **Postgres** en el puerto 5432
	- **Backend** NestJS en el puerto 3000 (hot-reload)
	- **Frontend** Angular en el puerto 4200 (hot-reload)

5. **Verifica que todo funciona:**
	- Accede a [http://localhost:4200](http://localhost:4200) para ver el frontend.
	- Accede a [http://localhost:3000](http://localhost:3000) para ver el backend (API).

6. **Ver logs en tiempo real (opcional):**
	Abre nuevas terminales y ejecuta:
	```bash
	docker compose logs -f backend
	docker compose logs -f frontend
	```

7. **Instalar nuevas dependencias:**
	- Instala paquetes desde tu máquina local (el código está mapeado):
	```bash
	cd vendix_backend && npm install <paquete>
	cd ../vendix_app && npm install <paquete>
	```
	- Reinicia el servicio si es necesario:
	```bash
	docker compose restart backend
	docker compose restart frontend
	```

8. **Detener el entorno:**
	```bash
	docker compose down
	```

---

¿Dudas? Consulta los archivos de configuración o abre un issue.

## Variables de entorno importantes (backend)
El backend toma las variables de `/vendix_backend/.env`. Ejemplo:

```
DATABASE_URL="postgresql://username:password@db:5432/vendix_db?schema=public"
JWT_SECRET=... # Cambia esto en producción
PORT=3000
NODE_ENV=production
```

## Prisma y migraciones
El contenedor del backend copia el esquema Prisma y ejecuta automáticamente las migraciones al iniciar.

## Notas
- El frontend se comunica con el backend usando la URL interna `http://vendix_backend:3000`.
- Puedes personalizar los puertos en `docker-compose.yml` si lo necesitas.
- Los archivos `.dockerignore` y los Dockerfile están optimizados para producción.

---

¿Dudas? Consulta los archivos de configuración o abre un issue.
