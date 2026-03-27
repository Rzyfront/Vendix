# setting-toggle

Toggle para ajustes de configuracion. Implementa `ControlValueAccessor` para integracion con Reactive Forms.

## Uso

```html
<!-- Two-way binding -->
<app-setting-toggle label="Notificaciones push" description="Recibe alertas en tiempo real" [(ngModel)]="settings.notifications"></app-setting-toggle>

<!-- Output event -->
<app-setting-toggle label="Modo oscuro" [isNew]="true" (changed)="onDarkModeChange($event)"></app-setting-toggle>
```

## Inputs

| Input         | Tipo      | Default     | Descripcion                           |
| ------------- | --------- | ----------- | ------------------------------------- |
| `label`       | `string`  | `''`        | Etiqueta del ajuste                   |
| `description` | `string`  | `undefined` | Descripcion adicional                 |
| `disabled`    | `boolean` | `false`     | Deshabilitar toggle                   |
| `isNew`       | `boolean` | `false`     | Muestra badge "Nuevo" y borde naranja |

## Outputs

| Output    | Tipo                    | Descripcion                  |
| --------- | ----------------------- | ---------------------------- |
| `changed` | `EventEmitter<boolean>` | Emite cuando el valor cambia |

## Importante

- Implementa `ControlValueAccessor` — compatible con `[(ngModel)]` y `formControl`
- El `disabled` funciona tanto como input como via `setDisabledState()`
- El contenedor es clickeable y propaga el toggle al componente interno `app-toggle`
- `isNew` activa un borde naranja y un badge "Nuevo" para destacar funciones recientes
