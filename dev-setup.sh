#!/bin/bash

echo "🚀 Iniciando flujo de desarrollo Vendix..."

# Función para verificar si el contenedor está ejecutándose
check_container() {
    if docker-compose ps | grep -q "vendix_backend"; then
        echo "✅ Contenedor backend ejecutándose"
        return 0
    else
        echo "❌ Contenedor backend no encontrado"
        return 1
    fi
}

# Función para verificar cambios en el esquema
check_schema_changes() {
    if git diff --name-only | grep -q "schema.prisma"; then
        echo "📝 Detectados cambios en schema.prisma"
        return 0
    else
        echo "✅ No hay cambios en schema.prisma"
        return 1
    fi
}

# Verificar si es primera vez o hay cambios
if ! check_container || check_schema_changes; then
    echo "🔄 Actualizando Prisma y base de datos..."

    # Generar cliente Prisma dentro del contenedor
    echo "📦 Generando cliente Prisma..."
    if check_container; then
        docker-compose exec -T backend npx prisma generate
    else
        npx prisma generate
    fi

    # Aplicar cambios a la base de datos
    echo "🗄️ Aplicando cambios a la base de datos..."
    if check_container; then
        docker-compose exec -T backend npx prisma db push
    else
        npx prisma db push
    fi

    # Ejecutar seed si es necesario
    read -p "¿Ejecutar seed de datos? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🌱 Ejecutando seed..."
        if check_container; then
            docker-compose exec -T backend npm run db:seed
        else
            npm run db:seed
        fi
    fi

    echo "🔄 Reiniciando servicios..."
    docker-compose down
    docker-compose up -d
else
    echo "✅ Todo está actualizado. Iniciando servicios..."
    docker-compose up -d
fi

echo "🎉 ¡Listo! Backend disponible en http://localhost:3000/api"
