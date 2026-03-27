# app-global-user-modals

Contenedor que renderiza los modales de perfil y configuracion de usuario. Responde al estado del `UserUiService`.

## Uso

Se inyecta una sola vez en el layout raiz de la app. No tiene inputs.

```html
<app-global-user-modals></app-global-user-modals>
```

## Arquitectura

Agrupa `<app-profile-modal>` y `<app-settings-modal>`, conectandolos al `UserUiService` para control de apertura/cierre.

## Importante

- Es un componente pasivo de presentacion; la logica de cuando abrir/cerra vive en `UserUiService`.
- No cerrar el modal manualmente; delegar al servicio con `userUiService.closeProfile()` o `userUiService.closeSettings()`.
