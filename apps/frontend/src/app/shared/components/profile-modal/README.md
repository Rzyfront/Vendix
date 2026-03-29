# app-profile-modal

Modal de edicion de perfil de usuario. Incluye vista de solo lectura, modo edicion, cambio de contrasena y carga de avatar.

## Uso

```html
<app-profile-modal [(isOpen)]="isProfileOpen" (isOpenChange)="onProfileChange($event)"> </app-profile-modal>
```

## Inputs

| Input    | Tipo      | Default | Descripcion                 |
| -------- | --------- | ------- | --------------------------- |
| `isOpen` | `boolean` | `false` | Controla apertura del modal |

## Outputs

| Output         | Tipo                    | Descripcion           |
| -------------- | ----------------------- | --------------------- |
| `isOpenChange` | `EventEmitter<boolean>` | Emite false al cerrar |

## Estructura de Secciones

1. **Vista de perfil** (solo lectura): avatar, nombre, email, telefono, documento, direccion, cuenta.
2. **Modo edicion**: formulario con nombre, telefono, documento, direccion (pais/region/ciudad en cascada para Colombia).
3. **Cambio de contrasena**: expandable, validacion de coincidencia.

## Importante

- El email no se puede editar (disabled en formulario).
- El avatar se sube a S3 via `POST /upload` con `entityType: 'avatars'`. El `pendingAvatarKey` se incluye en el payload de actualizacion.
- La direccion usa `CountryService` para cargar paises, departamentos y ciudades en cascada (Colombia por defecto).
- Durante carga inicial (primera vez que se abre), no muestra toasts de error para no molestar.
- Si la sesion expira durante interaccion, muestra toast de sesion expirada.
- Convierte IDs de departamento/ciudad a nombres al guardar y viceversa al editar.
