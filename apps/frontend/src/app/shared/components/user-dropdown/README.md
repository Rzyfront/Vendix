# user-dropdown

Dropdown de usuario con perfil, cambio de entorno (organizacion/tienda), pantalla completa y logout. Se integra con servicios de contexto y facade de autenticacion.

## Uso

```html
<!-- En el layout de la app — no requiere configuracion -->
<app-user-dropdown (closeDropdown)="onDropdownClose()"></app-user-dropdown>
```

## Outputs

| Output          | Tipo                 | Descripcion                        |
| --------------- | -------------------- | ---------------------------------- |
| `closeDropdown` | `EventEmitter<void>` | Emite cuando se cierra el dropdown |

## Importante

- No tiene inputs — toda la info viene de `GlobalFacade.userContext$` y `AuthFacade`
- Muestra el nombre completo generado de `first_name + last_name`, email, iniciales y rol
- Badge "nuevos modulos" aparece cuando `authFacade.hasNewModules$` es true
- Refresca `default_panel_ui` desde la API al abrir para detectar modulos nuevos
- Menu de opciones con `condition` dinamico (solo muestra "Pantalla Completa" o "Salir de Pantalla Completa" segun estado)
- Cambio de entorno via `EnvironmentSwitchService.performEnvironmentSwitch('ORG_ADMIN'|'STORE_ADMIN', slug?)`
- Click fuera o `Escape` cierra el dropdown
- Desktop: trigger completo con avatar, nombre y rol. Mobile: solo avatar
