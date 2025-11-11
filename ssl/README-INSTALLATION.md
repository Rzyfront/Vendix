# Instalación de Certificados SSL para Desarrollo Local

## 📋 Resumen

Esta guía explica cómo instalar los certificados SSL generados para que Windows y los navegadores reconozcan tu entorno de desarrollo local de Vendix como seguro.

## 🎯 Objetivo

Evitar advertencias de seguridad en navegadores al acceder a:

- `https://vendix.com`
- `https://www.vendix.com`
- `https://api.vendix.com`
- `https://*.vendix.com` (cualquier subdominio)

## 📁 Archivos Generados

```
ssl/
├── ca/
│   ├── ca-cert.pem          # Certificado de la CA (para instalar en Windows)
│   └── ca-key.pem           # Clave privada de la CA (NO compartir)
├── certs/
│   ├── vendix-cert.pem      # Certificado del servidor
│   ├── vendix_com.crt       # Certificado para Nginx
│   ├── vendix_com.key       # Clave para Nginx
│   ├── vendix-fullchain.crt # Certificado + CA (alternativa para Windows)
│   └── vendix.pfx           # Formato PFX para Windows
└── private/
    └── vendix-key.pem       # Clave privada del servidor
```

---

## 🪟 Instalación en Windows

### Método 1: Usando el Administrador de Certificados (Recomendado)

1. **Copiar el certificado CA a Windows**

   ```bash
   # Desde WSL, copia el archivo a tu escritorio de Windows
   cp /home/rzyfront/Vendix/ssl/ca/ca-cert.pem /mnt/c/Users/TU_USERNAME/Desktop/vendix-ca.crt
   ```

2. **Instalar el certificado**
   - Presiona `Win + R`, escribe `certmgr.msc` y presiona Enter
   - Navega a **Entidades de certificación de confianza raíz** → **Certificados**
   - Clic derecho → **Todas las tareas** → **Importar...**
   - Selecciona el archivo `vendix-ca.crt` de tu escritorio
   - Asegúrate de seleccionar **"Colocar todos los certificados en el siguiente almacén"**
   - Elige **"Entidades de certificación de confianza raíz"**
   - Completa el asistente

### Método 2: Usando PowerShell (Administrador)

```powershell
# Ejecutar como Administrador
Import-Certificate -FilePath "C:\Users\TU_USERNAME\Desktop\vendix-ca.crt" -CertStoreLocation Cert:\LocalMachine\Root
```

### Método 3: Doble clic (Más simple pero menos control)

1. Doble clic en `vendix-ca.crt`
2. Haz clic en **"Instalar certificado..."**
3. Selecciona **"Equipo local"**
4. Elige **"Colocar todos los certificados en el siguiente almacén"**
5. Selecciona **"Entidades de certificación de confianza raíz"**
6. Completa la instalación

---

## 🌐 Instalación en Navegadores

### Google Chrome/Edge (Basados en Chromium)

Generalmente usan el almacén de certificados de Windows, pero si tienes problemas:

1. Ve a `chrome://settings/certificates`
2. Ve a la pestaña **"Autoridades"**
3. Haz clic en **"Importar"**
4. Selecciona `vendix-ca.crt`
5. Marca **"Confiar en este certificado para identificar sitios web"**

### Firefox

Firefox usa su propio almacén de certificados:

1. Ve a `about:preferences#privacy`
2. Desplázate hasta **"Certificados"** y haz clic en **"Ver certificados..."**
3. Ve a la pestaña **"Autoridades"**
4. Haz clic en **"Importar..."**
5. Selecciona `vendix-ca.crt`
6. Marca **"Confiar en esta CA para identificar sitios web"**

---

## 🐧 Configuración Docker/Nginx

### 1. Montar certificados en el contenedor Nginx

Asegúrate que tu `docker-compose.yml` tenga los volúmenes:

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl/certs:/etc/ssl/certs:ro
      - ./ssl/private:/etc/ssl/private:ro
```

### 2. Reiniciar contenedores

```bash
docker-compose down
docker-compose up -d
```

### 3. Verificar configuración SSL

```bash
# Verificar que Nginx está usando los certificados
docker exec vendix_nginx nginx -t

# Verificar certificados montados
docker exec vendix_nginx ls -la /etc/ssl/certs/
```

---

## 🔍 Verificación

### 1. Verificar certificado con OpenSSL

```bash
# Desde WSL
openssl s_client -connect vendix.com:443 -servername vendix.com

# Deberías ver:
# - Certificate chain
# - Subject: CN=*.vendix.com
# - Issuer: CN=Vendix Development Development CA
```

### 2. Probar en navegador

1. Abre `https://vendix.com` en tu navegador
2. Deberías ver el candado verde sin advertencias
3. Haz clic en el candado → "La conexión es segura"
4. Verifica que el certificado está emitido por "Vendix Development Development CA"

---

## 🛠️ Solución de Problemas

### Problema: "La conexión no es privada"

**Causa**: La CA no está instalada correctamente
**Solución**:

1. Verifica que la CA esté en "Entidades de certificación de confianza raíz"
2. Reinicia el navegador
3. Limpia caché y cookies del dominio

### Problema: "ERR_CERT_COMMON_NAME_INVALID"

**Causa**: El dominio no coincide con el certificado
**Solución**:

1. Verifica que estás usando `vendix.com` o `www.vendix.com`
2. Asegúrate que tu archivo `hosts` apunte correctamente:
   ```
   127.0.0.1 vendix.com www.vendix.com api.vendix.com
   ```

### Problema: "ERR_SSL_PROTOCOL_ERROR"

**Causa**: Nginx no está configurado correctamente
**Solución**:

1. Verifica logs de Nginx: `docker logs vendix_nginx`
2. Revisa que los archivos de certificado existan en el contenedor
3. Verifica configuración SSL en `nginx.conf`

### Problema: Certificado expirado

**Causa**: Los certificados tienen fecha de expiración
**Solución**:

```bash
# Regenerar certificados
cd /home/rzyfront/Vendix
./ssl/generate-certificates.sh
```

---

## 📝 Notas Importantes

1. **Solo para desarrollo**: Estos certificados son válidos solo para desarrollo local
2. **No compartir claves**: Nunca compartas archivos `.key` o `ca-key.pem`
3. **Validez**: Los certificados son válidos por 10 años (3650 días)
4. **Multi-navegador**: Una vez instalada la CA, funciona en todos los navegadores
5. **Subdominios**: El certificado wildcard cubre todos los subdominios de `vendix.com`

---

## 🔄 Mantenimiento

### Regenerar certificados

Si necesitas regenerar los certificados:

```bash
cd /home/rzyfront/Vendix
./ssl/generate-certificates.sh
```

### Actualizar en Windows

Solo necesitas reinstalar si la CA cambia (muy raro en desarrollo).

---

## ✅ Checklist Final

- [ ] CA instalada en Windows (Entidades de certificación de confianza raíz)
- [ ] Archivo `hosts` configurado con los dominios
- [ ] Docker volumes configurados correctamente
- [ ] Nginx reiniciado y sin errores
- [ ] Navegadores muestran candado verde
- [ ] Todos los subdominios funcionan con HTTPS

¡Listo! Tu entorno de desarrollo multitenant ahora tiene SSL completamente funcional. 🎉
