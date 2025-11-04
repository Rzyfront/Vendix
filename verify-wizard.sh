#!/bin/bash

# 🚀 Script de Verificación del Wizard de Onboarding
# Este script verifica que todos los archivos necesarios estén creados
# y compila el proyecto para verificar que no haya errores

echo "======================================================"
echo "🚀 VERIFICACIÓN DEL WIZARD DE ONBOARDING"
echo "======================================================"
echo ""

# Colores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Contador de archivos
TOTAL_FILES=0
FOUND_FILES=0
MISSING_FILES=0

# Función para verificar archivo
check_file() {
    local file=$1
    local description=$2
    TOTAL_FILES=$((TOTAL_FILES + 1))
    
    if [ -f "$file" ]; then
        echo -e "${GREEN}✅${NC} $description"
        FOUND_FILES=$((FOUND_FILES + 1))
        return 0
    else
        echo -e "${RED}❌${NC} $description - ${RED}FALTANTE${NC}"
        echo "   Ruta: $file"
        MISSING_FILES=$((MISSING_FILES + 1))
        return 1
    fi
}

echo "📋 Verificando archivos del Backend..."
echo "------------------------------------------------------"

# DTOs Backend
check_file "apps/backend/src/modules/onboarding/dto/setup-user-wizard.dto.ts" "DTO: Setup User Wizard"
check_file "apps/backend/src/modules/onboarding/dto/setup-organization-wizard.dto.ts" "DTO: Setup Organization Wizard"
check_file "apps/backend/src/modules/onboarding/dto/setup-store-wizard.dto.ts" "DTO: Setup Store Wizard"
check_file "apps/backend/src/modules/onboarding/dto/setup-app-config-wizard.dto.ts" "DTO: Setup App Config Wizard"

# Servicios y Controladores Backend
check_file "apps/backend/src/modules/onboarding/onboarding-wizard.service.ts" "Servicio: Onboarding Wizard"
check_file "apps/backend/src/modules/onboarding/onboarding-wizard.controller.ts" "Controlador: Onboarding Wizard"
check_file "apps/backend/src/modules/onboarding/onboarding.module.ts" "Módulo: Onboarding (actualizado)"

echo ""
echo "📱 Verificando archivos del Frontend..."
echo "------------------------------------------------------"

# Servicio Frontend
check_file "apps/frontend/src/app/core/services/onboarding-wizard.service.ts" "Servicio Angular: Onboarding Wizard"

# Componente Principal
check_file "apps/frontend/src/app/public/onboarding-wizard/onboarding-wizard.component.ts" "Componente: Wizard Principal (TS)"
check_file "apps/frontend/src/app/public/onboarding-wizard/onboarding-wizard.component.html" "Componente: Wizard Principal (HTML)"
check_file "apps/frontend/src/app/public/onboarding-wizard/onboarding-wizard.component.scss" "Componente: Wizard Principal (SCSS)"

# Componentes de Pasos
check_file "apps/frontend/src/app/public/onboarding-wizard/steps/email-verification-step.component.ts" "Step 2: Email Verification"
check_file "apps/frontend/src/app/public/onboarding-wizard/steps/user-setup-step.component.ts" "Step 3: User Setup"
check_file "apps/frontend/src/app/public/onboarding-wizard/steps/organization-setup-step.component.ts" "Step 4: Organization Setup"
check_file "apps/frontend/src/app/public/onboarding-wizard/steps/store-setup-step.component.ts" "Step 5: Store Setup"
check_file "apps/frontend/src/app/public/onboarding-wizard/steps/app-config-step.component.ts" "Step 6: App Config"
check_file "apps/frontend/src/app/public/onboarding-wizard/steps/completion-step.component.ts" "Step 7: Completion"

echo ""
echo "📚 Verificando documentación..."
echo "------------------------------------------------------"

check_file "apps/frontend/src/app/public/onboarding-wizard/README.md" "README del Wizard"
check_file "WIZARD_INTEGRATION_GUIDE.md" "Guía de Integración"
check_file "IMPLEMENTATION_SUMMARY.md" "Resumen de Implementación"

echo ""
echo "======================================================"
echo "📊 RESUMEN DE VERIFICACIÓN"
echo "======================================================"
echo -e "Total de archivos esperados: ${YELLOW}$TOTAL_FILES${NC}"
echo -e "Archivos encontrados: ${GREEN}$FOUND_FILES${NC}"
echo -e "Archivos faltantes: ${RED}$MISSING_FILES${NC}"
echo ""

if [ $MISSING_FILES -eq 0 ]; then
    echo -e "${GREEN}✅ ¡TODOS LOS ARCHIVOS ESTÁN PRESENTES!${NC}"
    echo ""
    
    # Preguntar si desea compilar
    echo "======================================================"
    echo "🔨 COMPILACIÓN"
    echo "======================================================"
    read -p "¿Deseas compilar el backend ahora? (y/n) " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        echo "Compilando backend..."
        cd apps/backend
        npm run build
        BUILD_STATUS=$?
        cd ../..
        
        if [ $BUILD_STATUS -eq 0 ]; then
            echo -e "${GREEN}✅ Backend compilado exitosamente${NC}"
        else
            echo -e "${RED}❌ Error al compilar backend${NC}"
        fi
    fi
    
    echo ""
    read -p "¿Deseas compilar el frontend ahora? (y/n) " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        echo "Compilando frontend..."
        cd apps/frontend
        npm run build
        BUILD_STATUS=$?
        cd ../..
        
        if [ $BUILD_STATUS -eq 0 ]; then
            echo -e "${GREEN}✅ Frontend compilado exitosamente${NC}"
        else
            echo -e "${RED}❌ Error al compilar frontend${NC}"
        fi
    fi
    
    echo ""
    echo "======================================================"
    echo "✨ SIGUIENTE PASO"
    echo "======================================================"
    echo "1. Revisa WIZARD_INTEGRATION_GUIDE.md para integración"
    echo "2. Actualiza app.routes.ts con la nueva ruta"
    echo "3. Crea/actualiza guards de autenticación"
    echo "4. Modifica flujo de registro para redirigir al wizard"
    echo ""
    echo "¡Tu wizard está listo para integrarse! 🚀"
else
    echo -e "${RED}❌ FALTAN ARCHIVOS POR CREAR${NC}"
    echo ""
    echo "Por favor, verifica los archivos marcados como faltantes arriba."
fi

echo ""
