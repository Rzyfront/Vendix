# PromptModal

Modal que solicita un valor de texto al usuario antes de confirmar. Encapsula `ModalComponent`, `ButtonComponent` e `InputComponent`.

## Uso

```html
<app-prompt-modal [isOpen]="showPrompt" title="Renombrar archivo" message="Ingresa el nuevo nombre:" placeholder="Nombre del archivo" defaultValue="archivo-actual" confirmText="Renombrar" size="sm" (confirm)="onRename($event)" (cancel)="onCancelPrompt()" (isOpenChange)="showPrompt = $event"> </app-prompt-modal>
```

## Inputs

| Input           | Tipo                 | Default          | Descripcion                        |
| --------------- | -------------------- | ---------------- | ---------------------------------- |
| isOpen          | boolean              | true             | Control de visibilidad             |
| title           | string               | 'Ingresar valor' | Titulo del modal                   |
| message         | string               | ''               | Mensaje descriptivo sobre el campo |
| placeholder     | string               | ''               | Placeholder del campo de texto     |
| defaultValue    | string               | ''               | Valor inicial del campo            |
| confirmText     | string               | 'Aceptar'        | Texto del boton confirmar          |
| cancelText      | string               | 'Cancelar'       | Texto del boton cancelar           |
| size            | 'sm' \| 'md' \| 'lg' | 'sm'             | Tamano del modal                   |
| showCloseButton | boolean              | true             | Mostrar boton X                    |
| customClasses   | string               | ''               | Clases CSS adicionales             |

## Outputs

| Output       | Tipo         | Descripcion                       |
| ------------ | ------------ | --------------------------------- |
| confirm      | EventEmitter | Emite el valor de texto ingresado |
| cancel       | EventEmitter | Emite cuando se cancela           |
| isOpenChange | EventEmitter | Emite false al cerrar             |

## Importante

- El valor del input se reinicia a `defaultValue` en `ngOnInit`.
- Al confirmar, emite el valor actual del input y cierra el modal.
- Depende de `ModalComponent`, `ButtonComponent` e `InputComponent`.
