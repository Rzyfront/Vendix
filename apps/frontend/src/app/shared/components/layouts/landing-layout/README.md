# LandingLayout

Layout base para paginas publicas tipo landing page. Incluye header fijo con logo y boton de login, slot para contenido, y footer simple.

## Uso

```html
<app-landing-layout brandName="Mi Tienda" [logoUrl]="storeLogoUrl">
  <!-- Contenido de la landing page -->
  <div class="hero">
    <h1>Bienvenido a Mi Tienda</h1>
  </div>
</app-landing-layout>
```

## Inputs

| Input     | Tipo   | Default   | Descripcion                                                 |
| --------- | ------ | --------- | ----------------------------------------------------------- |
| brandName | string | 'Store'   | Nombre de la marca (usado en header y footer)               |
| logoUrl   | string | undefined | URL del logo (opcional; si no existe muestra icono de cart) |

## Importante

- El header es fijo (`fixed`) con z-index alto y fondo blur. El contenido principal tiene `pt-16` para evitar solapamiento.
- El boton "Iniciar Sesion" navega a `/auth/login` (redireccion via `window.location.href`).
- El footer muestra el anio actual (`currentYear`) y "Powered by Vendix".
- El slot de contenido usa `<ng-content>` para proyeccion de contenido hijo.
- Diseñado para paginas publicas sin sidebar ni header admin.
