
# 📄 Decisiones de Diseño: Login, Registro, Autenticación y Onboarding en Vendix
Documento técnico y de experiencia de usuario – Versión 1.0

---

🔹 **1. Formas de Registro**

**a) Desde Vendix (plataforma principal)**
- Propósito: Crear una cuenta como Owner (dueño) de una nueva organización y sus tiendas.
- El usuario registrado será el administrador principal de la organización.
- Cada registro genera una cuenta única, incluso si el email ya existe en otra organización.
- **Onboarding inteligente:** Si el usuario inicia el registro pero no completa el onboarding, al volver a registrarse con el mismo email, se le redirige automáticamente a continuar el proceso pendiente.

**b) Desde una tienda (subdominio o dominio propio)**
- Propósito: Registrar una cuenta de cliente para una tienda específica.
- El usuario será cliente exclusivo de esa tienda/organización.
- Cada cuenta es única y asociada al contexto de la tienda y organización.

**c) Desde el panel administrativo**
- Propósito: Crear cuentas de staff o empleados.
- Solo accesible por usuarios con permisos administrativos.
- Las cuentas creadas están ligadas a la organización o tienda correspondiente.

---

🔹 **2. Independencia de Cuentas**

✅ Cada cuenta es completamente independiente, incluso si comparten el mismo email.
🔍 El ámbito (scope) de la cuenta está definido por:
   - Organización
   - Tienda (si aplica)
🚫 No hay sincronización ni mezcla de datos entre cuentas del mismo email en distintas organizaciones.

---

🔹 **3. Onboarding Inconcluso**

🛠️ Si un usuario inicia el registro de una organización pero no lo completa:
   - Al intentar registrarse nuevamente con el mismo email, el sistema detecta el estado pendiente.
   - Se le redirige a continuar el onboarding desde donde lo dejó.
⛔ No se permite crear una nueva cuenta hasta que:
   - El onboarding actual se complete, o
   - Se cancele explícitamente el proceso anterior.

---

🔹 **4. Recuperación de Contraseña**

🔐 El proceso de recuperación es contextual:

**Desde una tienda**
- Se busca por _email + tienda_. Se envía reset solo para esa cuenta.

**Desde Vendix (plataforma)**
- Se solicita la _organización_. Si no se recuerda, opcionalmente se envía un correo con todas las organizaciones donde tiene cuentas asociadas.

📧 Importante:
- No se revelan otras cuentas del mismo email.
- Los mensajes son genéricos para evitar fugas de información.

---

🔹 **5. Experiencia de Usuario (UX)**

🎯 Objetivo: Que el usuario no se confunda con múltiples identidades.
- Cada cuenta se trata como una identidad independiente.
- El login es contextual: el frontend detecta la tienda (por subdominio o dominio) y solo permite acceso a la cuenta asociada.
- El usuario no ve sus cuentas en otras organizaciones, a menos que sea dueño de múltiples tiendas en Vendix.

---

🔹 **6. Seguridad y Privacidad**

🛡️ Principios clave:
- ❌ El email no es identificador global único.
- ✅ Todas las búsquedas se hacen por: _email + organización [+ tienda]_
- 🚫 No hay acceso cruzado entre cuentas del mismo email en distintas organizaciones.
- ⚠️ Mensajes de error genéricos para evitar enumeración de cuentas.

---

🔹 **7. Resumen de Ventajas**

✅ **Multi-tenant flexible**
Soporta múltiples organizaciones, tiendas y roles sin conflictos.

✅ **UX clara**
Cada experiencia es aislada y coherente.

✅ **Privacidad reforzada**
Sin exposición de cuentas cruzadas.

✅ **Escalable**
Diseño preparado para crecer con cientos de tiendas y usuarios.

---

🔹 **8. Flujos Detallados**

✅ **Registro desde Vendix (Owner de Organización)**
1. Usuario ingresa email y datos para crear organización.
2. Sistema verifica:
    - ¿Existe cuenta con ese email + organización?
       - ✅ Sí, onboarding incompleto → Redirigir a continuar onboarding.
       - ✅ Sí, onboarding completo → Mostrar mensaje: "Ya tienes una cuenta en esta organización. ¿Olvidaste tu contraseña?"
       - ✅ Email usado en otras orgs, pero no en esta → Crear nueva cuenta y comenzar onboarding.
       - ❌ No existe → Crear cuenta y comenzar onboarding inmediatamente.
3. 🚀 "Onboarding más rápido de la historia" activado.

✅ **Registro desde una Tienda (Cliente)**
1. Usuario ingresa email y datos en la tienda.
2. Sistema verifica:
    - ¿Existe cuenta con ese email + tienda?
       - ✅ Sí → Mostrar: "Ya tienes una cuenta en esta tienda. Inicia sesión."
       - ❌ No → Crear nueva cuenta y asociar a la tienda.

✅ **Registro de Staff desde Panel Administrativo**
1. Administrador ingresa datos del nuevo empleado.
2. Sistema crea una nueva cuenta de staff.
3. Cuenta asociada a la organización/tienda actual.
4. Opcional: envío de correo de bienvenida con credenciales temporales.

✅ **Recuperación de Contraseña**

**Desde tienda**
1. Buscar por _email + tienda_.
2. Enviar enlace de recuperación solo para esa cuenta.

**Desde Vendix (sin contexto)**
1. Pedir que seleccione la organización.
2. Si no la recuerda, enviar correo con lista de organizaciones donde tiene cuenta.

💡 **Nota técnica:**
Todos los flujos deben implementarse considerando el contexto de organización y tienda para garantizar:
- Independencia de cuentas
- Seguridad
- Claridad en la experiencia de usuario
