# app-under-construction

Pagina de estado para modulos en construccion. Soporta titulo y descripcion personalizables via @Input o datos de ruta.

## Uso

```html
<!-- Con valores por defecto -->
<app-under-construction></app-under-construction>

<!-- Con inputs -->
<app-under-construction title="Nuevo Modulo" description="Este modulo estara disponible pronto."> </app-under-construction>
```

## Inputs

| Input         | Tipo     | Default             | Descripcion            |
| ------------- | -------- | ------------------- | ---------------------- |
| `title`       | `string` | `'En Construccion'` | Titulo del mensaje     |
| `description` | `string` | mensaje por defecto | Descripcion del estado |

## Importante

- Tambien acepta titulo y descripcion desde `route.snapshot.data` (route data binding).
- Si se proveen tanto el input como la data de ruta, la data de ruta tiene prioridad.
- Boton "Volver" usa `window.history.back()`.
