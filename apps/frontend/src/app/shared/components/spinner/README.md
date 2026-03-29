# Spinner

Componente de carga animado con tamano configurable y opcion de texto.

## Uso

```html
<!-- Spinner basico -->
<app-spinner></app-spinner>

<!-- Tamano small con texto -->
<app-spinner size="sm" text="Cargando..."></app-spinner>

<!-- Spinner centrado en contenedor -->
<app-spinner size="lg" [center]="true"></app-spinner>

<!-- Spinner con color personalizado -->
<app-spinner size="md" color="text-blue-500"></app-spinner>

<!-- Clases CSS personalizadas -->
<app-spinner size="md" customClasses="my-custom-spinner"></app-spinner>
```

## Inputs

| Input         | Tipo        | Default        | Descripcion                                   |
| ------------- | ----------- | -------------- | --------------------------------------------- |
| size          | SpinnerSize | 'md'           | Tamano: 'sm' \| 'md' \| 'lg' \| 'xl'          |
| text          | string      | undefined      | Texto opcional junto al spinner               |
| color         | string      | 'text-primary' | Clase CSS para el color del icono             |
| center        | boolean     | false          | Centra el spinner usando flex y w-full h-full |
| customClasses | string      | ''             | Clases CSS adicionales                        |

## Importante

- El tamano afecta tanto el icono SVG como el texto (si existe).
- El color por defecto usa la variable CSS `--color-primary`.
- Usar `[center]="true"` solo cuando el spinner esta dentro de un contenedor con altura definida.
