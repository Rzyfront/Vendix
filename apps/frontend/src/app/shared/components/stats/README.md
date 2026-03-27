# stats

Tarjeta de estadistica reutilizable con icono, titulo, valor y texto secundario.

## Uso

```html
<!-- Basico -->
<app-stats title="Total Productos" [value]="totalProducts" iconName="package" iconBgColor="bg-primary/10" iconColor="text-primary"></app-stats>

<!-- Con texto secundario y loading -->
<app-stats title="Ingresos" [value]="formatCurrency(revenue)" smallText="+15% vs mes anterior" iconName="dollar-sign" iconBgColor="bg-green-100" iconColor="text-green-600" [loading]="isLoading"></app-stats>
```

## Inputs

| Input         | Tipo               | Default           | Descripcion                    |
| ------------- | ------------------ | ----------------- | ------------------------------ |
| `title`       | `string`           | `required`        | Titulo de la tarjeta           |
| `value`       | `string \| number` | `''`              | Valor principal                |
| `smallText`   | `string`           | `undefined`       | Texto pequeno debajo del valor |
| `iconName`    | `string`           | `'info'`          | Nombre del icono Lucide        |
| `iconBgColor` | `string`           | `'bg-primary/10'` | Color de fondo del icono       |
| `iconColor`   | `string`           | `'text-primary'`  | Color del icono                |
| `clickable`   | `boolean`          | `false`           | Efecto hover y cursor pointer  |
| `loading`     | `boolean`          | `false`           | Muestra estado de carga        |

## Importante

- `value` acepta `string` o `number` — ideal para formateo externo de monedas/fechas
- Los colores de icono son clases CSS arbitrarias (Tailwind classes)
- Reemplaza la logica repetitiva de tarjetas de estadisticas en POS y modulos de admin
