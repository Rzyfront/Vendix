# Tooltip

Tooltip contextual que aparece al hacer hover sobre el host. Soporta posicionamiento, tamano y esquemas de color.

## Uso

```html
<app-tooltip content="Informacion adicional aqui" position="top" size="md" color="default" [delay]="200">
  <button>Pasa el raton aqui</button>
</app-tooltip>

<!-- Variante con color primario -->
<app-tooltip content="Accion exitosa" position="bottom" color="primary">
  <span>Hover me</span>
</app-tooltip>
```

## Inputs

| Input    | Tipo            | Default   | Descripcion                                                                                               |
| -------- | --------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| size     | TooltipSize     | 'md'      | Tamano: 'sm' \| 'md' \| 'lg'                                                                              |
| position | TooltipPosition | 'top'     | Posicion: 'top' \| 'bottom' \| 'left' \| 'right'                                                          |
| color    | TooltipColor    | 'default' | Esquema de color: 'default' \| 'primary' \| 'secondary' \| 'accent' \| 'destructive' \| 'warning' \| 'ai' |
| visible  | boolean         | false     | Control manual de visibilidad (no requerido si se usa hover automatico)                                   |
| delay    | number          | 200       | Milisegundos de retardo antes de mostrar                                                                  |

## Importante

- El tooltip se muestra automaticamente al hacer hover y se oculta al salir, gracias a `@HostListener` en `mouseenter`/`mouseleave`.
- El contenido del tooltip se pasa via ng-content (slot por defecto).
- El tooltip usa posicionamiento fijo calculado contra el viewport para evitar desbordes horizontales y scroll lateral en contenedores estrechos.
- Soporta modo oscuro (`[data-theme='dark']`) para el color 'default'.
- El timeout de delay se limpia en `ngOnDestroy` para evitar memory leaks.
