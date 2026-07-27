# app-settings-modal

Modal de configuracion de usuario. Permite seleccionar tipo de aplicacion, tema visual y configurar la visibilidad de modulos del panel sidebar.

## Uso

```html
<app-settings-modal [(isOpen)]="isSettingsOpen" (isOpenChange)="onSettingsChange($event)"> </app-settings-modal>
```

## Inputs

| Input    | Tipo      | Default | Descripcion                 |
| -------- | --------- | ------- | --------------------------- |
| `isOpen` | `boolean` | `false` | Controla apertura del modal |

## Outputs

| Output         | Tipo                    | Descripcion           |
| -------------- | ----------------------- | --------------------- |
| `isOpenChange` | `EventEmitter<boolean>` | Emite false al cerrar |

## Secciones Principales

1. **Tipo de Aplicacion**: ORG_ADMIN (multi-tienda) o STORE_ADMIN (tienda unica).
2. **Preferencias**: los dos ejes del tema — **Modo** (claro / oscuro / sistema) y **Estilo** (default / aura / glass / monocromo). Cada swatch de estilo replica la receta real del preset; no son colores decorativos.
3. **Modulos del Panel**: toggles de visibilidad por modulo. Los modulos con hijos se sincronizan (padre toggle = hijos toggles).

## Importante

- El cambio de tipo de aplicacion solo es posible para owners/admins.
- La configuracion de modulos (`panel_ui`) se guarda en la settings del usuario via `AuthFacade.updateUserSettings()`.
- `hasModuleError()` valida que al menos un modulo este habilitado en el app type actual.
- El modal hace merge profundo de la config existente antes de guardar, preservando valores no editados.
- Los cuatro estilos estan activos (Aura y Glass ya no son "Proximamente").
- El swatch de "Default" es `.bg-surface`, asi que caia en las listas de superficie de Aura y Glass y se pintaba con el preset ACTIVO en vez del que representa. Lo protege la regla `.theme-preview.bg-surface` al final de la seccion de presets en `styles.scss`.
- Para cuentas SINGLE_STORE muestra el banner de upgrade a organizacion.
