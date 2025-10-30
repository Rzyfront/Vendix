#!/bin/bash

# Script para configurar Docker con los certificados SSL generados
# Autor: Asistente IA para Vendix
# Uso: chmod +x docker-setup.sh && ./docker-setup.sh

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🐳 Configurando Docker para SSL...${NC}"

# Verificar que los certificados existan
if [ ! -f "./ssl/certs/vendix_com.crt" ] || [ ! -f "./ssl/certs/vendix_com.key" ]; then
    echo -e "${RED}❌ Error: No se encuentran los certificados SSL${NC}"
    echo -e "${YELLOW}Ejecuta primero: ./ssl/generate-certificates.sh${NC}"
    exit 1
fi

# Verificar docker-compose.yml
echo -e "${GREEN}📋 Verificando configuración de Docker...${NC}"

if ! grep -q "./ssl/certs:/etc/ssl/certs:ro" docker-compose.yml; then
    echo -e "${RED}❌ Error: Los volúmenes de SSL no están configurados en docker-compose.yml${NC}"
    echo -e "${YELLOW}Asegúrate de tener los siguientes volúmenes en el servicio nginx:${NC}"
    echo -e "  - ./ssl/certs:/etc/ssl/certs:ro"
    echo -e "  - ./ssl/private:/etc/ssl/private:ro"
    exit 1
fi

echo -e "${GREEN}✅ Configuración de Docker verificada${NC}"

# Opcional: Verificar que nginx.conf tenga las rutas correctas
echo -e "${GREEN}🔍 Verificando configuración de Nginx...${NC}"

if grep -q "/etc/ssl/certs/vendix_com.crt" nginx.conf; then
    echo -e "${GREEN}✅ Nginx configurado correctamente${NC}"
else
    echo -e "${RED}❌ Error: nginx.conf no tiene las rutas correctas a los certificados${NC}"
    exit 1
fi

# Instrucciones finales
echo ""
echo -e "${GREEN}🎉 Configuración Docker completada${NC}"
echo ""
echo -e "${YELLOW}📋 Próximos pasos:${NC}"
echo -e "1. Instala la CA en Windows (ver ssl/README-INSTALLATION.md)"
echo -e "2. Configura tu archivo hosts de Windows:"
echo -e "   C:\\Windows\\System32\\drivers\\etc\\hosts"
echo -e "   Agrega: 127.0.0.1 vendix.com www.vendix.com api.vendix.com"
echo -e "3. Reinicia los contenedores:"
echo -e "   docker-compose down"
echo -e "   docker-compose up -d"
echo -e "4. Verifica que todo funcione:"
echo -e "   docker logs vendix_nginx"
echo ""
echo -e "${GREEN}✨ Listo para HTTPS!${NC}"