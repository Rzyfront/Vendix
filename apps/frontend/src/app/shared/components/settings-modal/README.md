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
2. **Preferencias**: selector de tema (default, monocromo).
3. **Modulos del Panel**: toggles de visibilidad por modulo. Los modulos con hijos se sincronizan (padre toggle = hijos toggles).

## Importante

- El cambio de tipo de aplicacion solo es posible para owners/admins.
- La configuracion de modulos (`panel_ui`) se guarda en la settings del usuario via `AuthFacade.updateUserSettings()`.
- `hasModuleError()` valida que al menos un modulo este habilitado en el app type actual.
- El modal hace merge profundo de la config existente antes de guardar, preservando valores no editados.
- Temas "Aura" y "Glass" estan marcados como "Proximamente".
- Para cuentas SINGLE_STORE muestra el banner de upgrade a organizacion.
