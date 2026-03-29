# app-help-search-overlay

Buscador de articulos del Centro de Ayuda con experiencia estilo spotlight/Command Palette. Usa `<dialog>` nativo para superposicion.

## Uso

Se puede incrustar en cualquier lugar. El boton de trigger abre el overlay.

```html
<app-help-search-overlay></app-help-search-overlay>
```

## Atajos de Teclado

| Tecla       | Accion                          |
| ----------- | ------------------------------- |
| `ESC`       | Cerrar overlay                  |
| `ArrowDown` | Navegar resultados hacia abajo  |
| `ArrowUp`   | Navegar resultados hacia arriba |
| `Enter`     | Seleccionar resultado activo    |

## Importante

- Requiere `HelpCenterService` del modulo `store/help`.
- Solo muestra resultados cuando el query tiene 2 o mas caracteres.
- Debounce de 300ms antes de buscar.
- Maximo 8 resultados.
- La navegacion cierra el overlay y redirige a `/admin/help/center/{slug}`.
- El `<dialog>` nativo se renderiza en top-layer, escapando todos los stacking contexts.
- El patron `spotlight` fue disehado para ser similar a Spotlight de macOS / VS Code.
