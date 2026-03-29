# ConfirmationModal

Modal de confirmacion con dos acciones: aceptar y cancelar. Encapsula `ModalComponent` y `ButtonComponent`.

## Uso

```html
<app-confirmation-modal [isOpen]="showConfirm" title="Eliminar producto" message="Esta accion no se puede deshacer. Continuar?" confirmText="Eliminar" cancelText="Cancelar" confirmVariant="danger" size="sm" (confirm)="onDelete()" (cancel)="onCancel()" (isOpenChange)="showConfirm = $event"> </app-confirmation-modal>
```

## Inputs

| Input           | Tipo                  | Default         | Descripcion                        |
| --------------- | --------------------- | --------------- | ---------------------------------- |
| isOpen          | boolean               | true            | Control de visibilidad del modal   |
| title           | string                | 'Confirmacion'  | Titulo del modal                   |
| message         | string                | 'Estas seguro?' | Mensaje descriptivo                |
| confirmText     | string                | 'Aceptar'       | Texto del boton de confirmacion    |
| cancelText      | string                | 'Cancelar'      | Texto del boton de cancelar        |
| confirmVariant  | 'primary' \| 'danger' | 'primary'       | Variante del boton de confirmacion |
| size            | 'sm' \| 'md' \| 'lg'  | 'sm'            | Tamano del modal                   |
| showCloseButton | boolean               | true            | Mostrar boton X para cerrar        |
| customClasses   | string                | ''              | Clases CSS adicionales             |

## Outputs

| Output       | Tipo         | Descripcion                            |
| ------------ | ------------ | -------------------------------------- |
| confirm      | EventEmitter | Emite cuando se hace click en aceptar  |
| cancel       | EventEmitter | Emite cuando se hace click en cancelar |
| isOpenChange | EventEmitter | Emite false al cerrar (para v-model)   |

## Importante

- Al confirmar o cancelar, el modal se cierra automaticamente (`isOpenChange.emit(false)`).
- El boton de confirmacion destruye por defecto con `confirmVariant="danger"`.
- Depende de `ModalComponent` y `ButtonComponent`.
