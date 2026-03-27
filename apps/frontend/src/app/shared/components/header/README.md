# Header

Barra de navegacion superior de la aplicacion admin. Incluye breadcrumb dinamico, logo mobile, notificaciones y menu de usuario.

## Uso

```html
<app-header [title]="'Ventas'" (toggleSidebar)="onToggleSidebar()"></app-header>
```

## Inputs

| Input      | Tipo   | Default           | Descripcion                                      |
| ---------- | ------ | ----------------- | ------------------------------------------------ |
| title      | string | 'Panel Principal' | Titulo fallback (se usa si no hay breadcrumb)    |
| breadcrumb | any    | {}                | Configuracion estatica del breadcrumb (opcional) |
| user       | any    | {}                | Datos del usuario (opcional)                     |

## Outputs

| Output        | Tipo         | Descripcion                       |
| ------------- | ------------ | --------------------------------- |
| toggleSidebar | EventEmitter | Emite al hacer click en hamburger |

## Importante

- El breadcrumb se alimenta automaticamente desde `BreadcrumbService` (observable `breadcrumb$`). El `title` se usa como fallback cuando no hay breadcrumb.
- En desktop muestra boton de toggle para sidebar; en mobile muestra logo + flecha para abrir sidebar.
- El logo mobile se resuelve desde `GlobalFacade.getBrandingContext()` o `ConfigFacade` (para dominios Vendix principales).
- Depende de: `UserDropdownComponent`, `NotificationsDropdownComponent`, `HelpSearchOverlayComponent`, `IconComponent`.
- El componente destruye la suscripcion al breadcrumb en `ngOnDestroy`.
