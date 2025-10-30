#!/bin/bash

# Script para generar CA local y certificados SSL para desarrollo multitenant
# Autor: Asistente IA para Vendix
# Uso: chmod +x generate-certificates.sh && ./generate-certificates.sh

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuración
DOMAIN="vendix.com"
COUNTRY="US"
STATE="California"
CITY="San Francisco"
ORGANIZATION="Vendix Development"
ORGANIZATIONAL_UNIT="IT Department"
EMAIL="dev@vendix.com"
VALIDITY_DAYS=3650

# Directorios
SSL_DIR="./ssl"
CERTS_DIR="$SSL_DIR/certs"
PRIVATE_DIR="$SSL_DIR/private"

echo -e "${GREEN}🔐 Generando certificados SSL para desarrollo local${NC}"
echo -e "${YELLOW}Dominio: $DOMAIN${NC}"
echo -e "${YELLOW}Validez: $VALIDITY_DAYS días${NC}"
echo ""

# Crear estructura de directorios
echo -e "${GREEN}📁 Creando estructura de directorios...${NC}"
mkdir -p "$CERTS_DIR"
mkdir -p "$PRIVATE_DIR"
mkdir -p "$SSL_DIR/ca"

# 1. Generar CA (Certificate Authority) local
echo -e "${GREEN}🏛️  Creando Certificate Authority local...${NC}"

# Configuración para la CA
cat > "$SSL_DIR/ca/ca.conf" << EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no

[req_distinguished_name]
C = $COUNTRY
ST = $STATE
L = $CITY
O = $ORGANIZATION
OU = $ORGANIZATIONAL_UNIT
CN = $ORGANIZATION Development CA
emailAddress = $EMAIL

[v3_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
extendedKeyUsage = serverAuth, clientAuth
EOF

# Generar clave privada de la CA
openssl genrsa -out "$SSL_DIR/ca/ca-key.pem" 4096

# Generar certificado de la CA
openssl req -new -x509 -days "$VALIDITY_DAYS" \
    -key "$SSL_DIR/ca/ca-key.pem" \
    -out "$SSL_DIR/ca/ca-cert.pem" \
    -config "$SSL_DIR/ca/ca.conf"

echo -e "${GREEN}✅ CA creada exitosamente${NC}"

# 2. Generar certificado wildcard para *.vendix.com
echo -e "${GREEN}🌐 Creando certificado wildcard para *.$DOMAIN...${NC}"

# Configuración para el certificado wildcard
cat > "$SSL_DIR/cert.conf" << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = $COUNTRY
ST = $STATE
L = $CITY
O = $ORGANIZATION
OU = $ORGANIZATIONAL_UNIT
CN = *.$DOMAIN
emailAddress = $EMAIL

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = *.$DOMAIN
DNS.3 = www.$DOMAIN
DNS.4 = api.$DOMAIN
DNS.5 = app.$DOMAIN
DNS.6 = admin.$DOMAIN
DNS.7 = dev.$DOMAIN
DNS.8 = test.$DOMAIN
DNS.9 = localhost
DNS.10 = 127.0.0.1
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

# Generar clave privada para el certificado
openssl genrsa -out "$PRIVATE_DIR/vendix-key.pem" 2048

# Generar CSR (Certificate Signing Request)
openssl req -new \
    -key "$PRIVATE_DIR/vendix-key.pem" \
    -out "$SSL_DIR/vendix.csr" \
    -config "$SSL_DIR/cert.conf"

# Firmar el certificado con nuestra CA
openssl x509 -req -in "$SSL_DIR/vendix.csr" \
    -CA "$SSL_DIR/ca/ca-cert.pem" \
    -CAkey "$SSL_DIR/ca/ca-key.pem" \
    -CAcreateserial \
    -out "$CERTS_DIR/vendix-cert.pem" \
    -days "$VALIDITY_DAYS" \
    -extensions v3_req \
    -extfile "$SSL_DIR/cert.conf"

echo -e "${GREEN}✅ Certificado wildcard creado exitosamente${NC}"

# 3. Crear copias en formatos estándar
echo -e "${GREEN}📋 Creando copias en formatos estándar...${NC}"

# Copiar certificado para Nginx
cp "$CERTS_DIR/vendix-cert.pem" "$CERTS_DIR/vendix_com.crt"
cp "$PRIVATE_DIR/vendix-key.pem" "$CERTS_DIR/vendix_com.key"

# Crear archivo .crt para Windows (concatenar CA + certificado)
cat "$SSL_DIR/ca/ca-cert.pem" "$CERTS_DIR/vendix-cert.pem" > "$CERTS_DIR/vendix-fullchain.crt"

# Crear archivo PFX para Windows (opcional, si tienes OpenSSL con soporte)
if command -v openssl >/dev/null 2>&1; then
    openssl pkcs12 -export \
        -out "$CERTS_DIR/vendix.pfx" \
        -inkey "$PRIVATE_DIR/vendix-key.pem" \
        -in "$CERTS_DIR/vendix-cert.pem" \
        -certfile "$SSL_DIR/ca/ca-cert.pem" \
        -passout pass:vendix123
    echo -e "${GREEN}✅ Archivo PFX creado para Windows${NC}"
fi

# 4. Limpiar archivos temporales
echo -e "${GREEN}🧹 Limpiando archivos temporales...${NC}"
rm -f "$SSL_DIR/vendix.csr"
rm -f "$SSL_DIR/ca/ca.srl"

# 5. Establecer permisos
echo -e "${GREEN}🔒 Estableciendo permisos...${NC}"
chmod 600 "$PRIVATE_DIR"/*
chmod 644 "$CERTS_DIR"/*
chmod 644 "$SSL_DIR/ca"/*

# 6. Verificar certificados
echo -e "${GREEN}🔍 Verificando certificados...${NC}"
echo ""
echo -e "${YELLOW}=== Información del Certificado Wildcard ===${NC}"
openssl x509 -in "$CERTS_DIR/vendix-cert.pem" -text -noout | grep -A 20 "Subject Alternative Name"

echo ""
echo -e "${YELLOW}=== Información de la CA ===${NC}"
openssl x509 -in "$SSL_DIR/ca/ca-cert.pem" -text -noout | grep -A 10 "Subject"

# 7. Resumen y próximos pasos
echo ""
echo -e "${GREEN}🎉 ¡Certificados generados exitosamente!${NC}"
echo ""
echo -e "${YELLOW}📁 Archivos creados:${NC}"
echo -e "  • CA: $SSL_DIR/ca/ca-cert.pem"
echo -e "  • Certificado: $CERTS_DIR/vendix-cert.pem"
echo -e "  • Clave privada: $PRIVATE_DIR/vendix-key.pem"
echo -e "  • Para Nginx: $CERTS_DIR/vendix_com.crt, $CERTS_DIR/vendix_com.key"
echo -e "  • Para Windows: $CERTS_DIR/vendix-fullchain.crt"
if [ -f "$CERTS_DIR/vendix.pfx" ]; then
    echo -e "  • PFX para Windows: $CERTS_DIR/vendix.pfx"
fi

echo ""
echo -e "${YELLOW}📋 Próximos pasos:${NC}"
echo -e "1. Copia la CA ($SSL_DIR/ca/ca-cert.pem) a Windows"
echo -e "2. Instala la CA en 'Certificados de confianza raíz'"
echo -e "3. Actualiza nginx.conf para usar los nuevos certificados"
echo -e "4. Reinicia Nginx/Docker"
echo ""
echo -e "${GREEN}✨ Listo para desarrollo SSL local!${NC}"