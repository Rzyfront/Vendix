# app-environment-indicator

Panel flotante en esquina superior derecha que muestra el entorno actual (Organizacion, Tienda, Vendix Admin) y permite cambiar entre ellos.

## Uso

Se inyecta en el layout principal de la app. No requiere inputs; lee el contexto del `EnvironmentContextService`.

```html
<app-environment-indicator></app-environment-indicator>
```

## Importante

- Posicion fixed en `top: 20px; right: 20px` (z-index: 1000).
- Muestra nombre de organizacion o tienda si esta disponible.
- Boton de switch aparece solo si el usuario tiene permisos para cambiar de entorno.
- El evento `onSwitchEnvironment()` despacha un `CustomEvent('switchEnvironment')` en `window` para que el componente padre lo maneje.
- Colores diferenciados por entorno: organizacion (purpura), tienda (rosa), Vendix (azul).
- Responde a cambios de entorno reactivamente via observable del servicio.
