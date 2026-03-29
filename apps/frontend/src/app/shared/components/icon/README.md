# Icon

Componente wrapper sobre `lucide-angular` que renderiza iconos SVG a partir de un registro centralizado.

## Uso

```html
<!-- Uso basico -->
<app-icon name="cart" [size]="16"></app-icon>

<!-- Con color y clases -->
<app-icon name="x" [size]="20" color="text-red-500" class="flex-shrink-0"></app-icon>

<!-- Spinning (para loading states) -->
<app-icon name="loader-2" [size]="20" [spin]="true"></app-icon>

<!-- Con binding de nombre -->
<app-icon [name]="iconName" [size]="24"></app-icon>
```

## Inputs

| Input | Tipo             | Default     | Descripcion                                    |
| ----- | ---------------- | ----------- | ---------------------------------------------- |
| name  | IconName         | (requerido) | Nombre del icono registrado en `ICON_REGISTRY` |
| size  | number \| string | 16          | Tamano del icono en px                         |
| color | string           | undefined   | Color CSS (clase o estilo)                     |
| class | string           | ''          | Alias para `[class]` (clases CSS adicionales)  |
| spin  | boolean          | false       | Aplica animacion de spin al icono              |

## IconName

Los nombres disponibles estan definidos en `icon/icons.registry.ts` dentro de `ICON_REGISTRY`. Se importan como:

```typescript
import { ICON_REGISTRY, IconName } from "./icons.registry";
```

## Importante

- `name` es un input requerido; lanza error si no se provee.
- Si el nombre no existe en el registro, renderiza el icono `default`.
- El registro centraliza todos los iconos en un solo lugar; para agregar nuevos iconos, editarlos en `icons.registry.ts`.
- `lucide-angular` se importa como `LucideAngularModule` (o el modulo equivalente).
