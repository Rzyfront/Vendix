# chart

Grafico configurable basado en ECharts (ngx-echarts). Soporta multiples tipos de grafica, temas y eventos.

## Uso

```typescript
import { ChartComponent, ChartTheme, CHART_THEMES } from "@/shared/components";
```

```html
<!-- Uso directo con ECharts options -->
<app-chart [options]="chartOptions" [size]="'large'" [theme]="CHART_THEMES['corporate']" (chartClick)="onClick($event)"></app-chart>
```

```typescript
chartOptions: EChartsOption = {
  xAxis: { type: "category", data: ["Ene", "Feb", "Mar"] },
  yAxis: { type: "value" },
  series: [{ type: "line", data: [120, 200, 150] }],
};
```

## Inputs

| Input         | Tipo                             | Default                     | Descripcion                         |
| ------------- | -------------------------------- | --------------------------- | ----------------------------------- |
| `options`     | `EChartsOption`                  | `{}`                        | Configuracion directa de ECharts    |
| `size`        | `'small' \| 'medium' \| 'large'` | `'medium'`                  | Tamanio del contenedor              |
| `className`   | `string`                         | `''`                        | Clases CSS adicionales              |
| `theme`       | `ChartTheme`                     | `CHART_THEMES['corporate']` | Tema de colores                     |
| `loading`     | `boolean`                        | `false`                     | Muestra spinner de carga            |
| `type`        | `ExtendedChartType`              | `'bar'`                     | Deprecated — usar `options.series`  |
| `data`        | `any`                            | `{}`                        | Deprecated — usar `options`         |
| `animated`    | `boolean`                        | `true`                      | Deprecated                          |
| `showLegend`  | `boolean`                        | `true`                      | Deprecated — usar `options.legend`  |
| `showTooltip` | `boolean`                        | `true`                      | Deprecated — usar `options.tooltip` |
| `exportable`  | `boolean`                        | `false`                     | Deprecated                          |

## Outputs

| Output       | Tipo                | Descripcion                   |
| ------------ | ------------------- | ----------------------------- |
| `chartClick` | `EventEmitter<any>` | Evento click sobre la grafica |
| `chartHover` | `EventEmitter<any>` | Evento hover sobre la grafica |

## Temas

```typescript
CHART_THEMES["corporate"]; // Azul/gris profesional
CHART_THEMES["vibrant"]; // Colores vibrantes
CHART_THEMES["dark"]; // Para modo oscuro
CHART_THEMES["minimal"]; // Colores sutiles
```

## Importante

- La forma recomendada es pasar `options` directamente como `EChartsOption`
- Los inputs `type`, `data`, `animated`, `showLegend`, `showTooltip`, `exportable` estan deprecated y se ignoran
- El componente aplica automaticamente `theme.colors`, `tooltip` y `legend` si no estan definidos en `options`
- Para el tema `'dark'`, establece `echartsTheme` interno
- Requiere `provideEchartsCore({ echarts })` en el modulo o provider
