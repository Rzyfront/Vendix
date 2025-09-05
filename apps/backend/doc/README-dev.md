# 🚀 Guía de Desarrollo - Vendix

## 📋 Flujo de Desarrollo Recomendado

### Opción 1: Automático (Recomendado)
```bash
# Script inteligente que detecta cambios automáticamente
./dev-setup.sh
```

### Opción 2: Manual (Control Total)
```bash
# 1. Verificar cambios en el esquema
git status

# 2. Si hay cambios en schema.prisma:
npx prisma generate
npx prisma db push

# 3. Si necesitas datos de prueba:
npm run prisma:seed

# 4. Iniciar servicios
docker-compose up -d
```

## 🔧 Comandos Útiles

```bash
# Ver estado de la base de datos
npx prisma studio

# Ver migraciones pendientes
npx prisma migrate status

# Resetear base de datos (cuidado!)
npx prisma migrate reset

# Generar cliente manualmente
npm run prisma:generate
```

## 📊 Cuándo Actualizar Prisma

### ✅ SIEMPRE actualizar:
- Después de modificar `schema.prisma`
- Al hacer `git pull` con cambios en el esquema
- Al cambiar de rama con diferencias en el esquema

### ❌ NO es necesario actualizar:
- Solo cambios en código TypeScript/JavaScript
- Cambios en documentación
- Cambios en configuración (excepto DB)

## 🗄️ Gestión de Base de Datos

### Primera vez:
```bash
docker-compose up -d
# Esperar a que PostgreSQL inicie
npm run prisma:generate
npm run prisma:db:push
npm run prisma:seed
```

### Desarrollo diario:
```bash
./dev-setup.sh
# o
docker-compose up -d
```

### Reset completo:
```bash
docker-compose down -v  # ⚠️ Borra todos los datos
docker-compose up -d
npm run prisma:generate
npm run prisma:db:push
npm run prisma:seed
```

## 🔍 Troubleshooting

### Error: "Client not generated"
```bash
npx prisma generate
```

### Error: "Database schema not up to date"
```bash
npx prisma db push
```

### Error: "Migration pending"
```bash
npx prisma migrate resolve --applied
```
