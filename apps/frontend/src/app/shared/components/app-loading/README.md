# app-loading

Pantalla de carga completa (fullscreen) con animacion SVG del logo Vendix.

## Uso

Se utiliza como pantalla inicial mientras la aplicacion carga. No requiere inputs ni outputs.

```html
<app-loading></app-loading>
```

## Importante

- Es un componente de presentacion pura, sin logica ni interaccion.
- Se posiciona fixed cubriendo toda la pantalla (z-index: 9999).
- El texto "Cargando aplicacion..." esta en espanol hardcodeado.
- Animacion del circulo SVG: stroke-dashoffset animado en 1.5s.
- No usar este componente para estados de carga parciales dentro de la app.
