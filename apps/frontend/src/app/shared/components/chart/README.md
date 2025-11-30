# ChartComponent - Beautiful & Configurable Charts

A powerful, reusable Angular chart component built on top of Chart.js and ng2-charts with beautiful themes, animations, and extensive customization options.

## 🚀 Features

- **9 Chart Types**: Bar, Line, Pie, Doughnut, Area, Radar, Polar Area, Scatter, Bubble
- **4 Beautiful Themes**: Corporate, Vibrant, Dark, Minimal
- **Advanced Animations**: Smooth transitions and loading states
- **Interactive Events**: Click and hover handlers
- **Responsive Design**: Automatic sizing and mobile-friendly
- **Customizable**: Extensive configuration options
- **TypeScript Support**: Full type safety
- **Zero Dependencies**: Uses existing Chart.js installation

## 📦 Installation

The component uses the already installed dependencies:

```bash
npm install chart.js ng2-charts
```

## 🎯 Quick Start

### Basic Usage

```typescript
import { Component } from "@angular/core";
import { ChartComponent, ChartData } from "@/shared/components";

@Component({
  selector: "app-my-component",
  standalone: true,
  imports: [ChartComponent],
  template: ` <app-chart [data]="chartData" type="bar" size="medium"> </app-chart> `,
})
export class MyComponent {
  chartData: ChartData = {
    labels: ["Jan", "Feb", "Mar", "Apr"],
    datasets: [
      {
        label: "Sales",
        data: [12000, 19000, 15000, 25000],
      },
    ],
  };
}
```

### With Theme and Customization

```typescript
import { Component } from "@angular/core";
import { ChartComponent, ChartData, CHART_THEMES } from "@/shared/components";

@Component({
  selector: "app-dashboard",
  standalone: true,
  imports: [ChartComponent],
  template: ` <app-chart [data]="revenueData" type="area" [theme]="CHART_THEMES['corporate']" [animated]="true" [showLegend]="true" size="large" (chartClick)="onChartClick($event)"> </app-chart> `,
})
export class DashboardComponent {
  CHART_THEMES = CHART_THEMES;

  revenueData: ChartData = {
    labels: ["Q1", "Q2", "Q3", "Q4"],
    datasets: [
      {
        label: "Revenue",
        data: [30000, 35000, 32000, 42000],
      },
      {
        label: "Profit",
        data: [12000, 15000, 14000, 18000],
      },
    ],
  };

  onChartClick(event: any): void {
    console.log("Chart clicked:", event);
  }
}
```

## 📊 Chart Types

### 1. Bar Chart

```typescript
<app-chart
  [data]="barData"
  type="bar"
  [theme]="selectedTheme">
</app-chart>
```

### 2. Line Chart

```typescript
<app-chart
  [data]="lineData"
  type="line"
  [theme]="selectedTheme">
</app-chart>
```

### 3. Area Chart (Line with fill)

```typescript
<app-chart
  [data]="areaData"
  type="area"
  [theme]="selectedTheme">
</app-chart>
```

### 4. Doughnut Chart

```typescript
<app-chart
  [data]="doughnutData"
  type="doughnut"
  [theme]="selectedTheme">
</app-chart>
```

### 5. Pie Chart

```typescript
<app-chart
  [data]="pieData"
  type="pie"
  [theme]="selectedTheme">
</app-chart>
```

### 6. Radar Chart

```typescript
<app-chart
  [data]="radarData"
  type="radar"
  [theme]="selectedTheme">
</app-chart>
```

### 7. Polar Area Chart

```typescript
<app-chart
  [data]="polarData"
  type="polarArea"
  [theme]="selectedTheme">
</app-chart>
```

### 8. Scatter Chart

```typescript
<app-chart
  [data]="scatterData"
  type="scatter"
  [theme]="selectedTheme">
</app-chart>
```

### 9. Bubble Chart

```typescript
<app-chart
  [data]="bubbleData"
  type="bubble"
  [theme]="selectedTheme">
</app-chart>
```

## 🎨 Themes

### Corporate Theme (Default)

Professional blue and gray colors perfect for business applications.

```typescript
import { CHART_THEMES } from '@/shared/components';

// Usage
<app-chart
  [data]="data"
  type="bar"
  [theme]="CHART_THEMES['corporate']">
</app-chart>
```

### Vibrant Theme

Bright, energetic colors for modern applications.

```typescript
<app-chart
  [data]="data"
  type="doughnut"
  [theme]="CHART_THEMES['vibrant']">
</app-chart>
```

### Dark Theme

Perfect for dark mode applications.

```typescript
<app-chart
  [data]="data"
  type="line"
  [theme]="CHART_THEMES['dark']">
</app-chart>
```

### Minimal Theme

Clean, subtle colors for minimalist designs.

```typescript
<app-chart
  [data]="data"
  type="bar"
  [theme]="CHART_THEMES['minimal']">
</app-chart>
```

## ⚙️ Properties

### Inputs

| Property      | Type                             | Default                        | Description                                                                    |
| ------------- | -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| `data`        | `ChartData`                      | `{ labels: [], datasets: [] }` | Chart data and datasets                                                        |
| `type`        | `ExtendedChartType`              | `'bar'`                        | Chart type (bar, line, pie, doughnut, area, radar, polarArea, scatter, bubble) |
| `theme`       | `ChartTheme`                     | `CHART_THEMES['corporate']`    | Color theme for the chart                                                      |
| `size`        | `'small' \| 'medium' \| 'large'` | `'medium'`                     | Container size                                                                 |
| `loading`     | `boolean`                        | `false`                        | Show loading spinner                                                           |
| `animated`    | `boolean`                        | `true`                         | Enable animations                                                              |
| `showLegend`  | `boolean`                        | `true`                         | Show chart legend                                                              |
| `showTooltip` | `boolean`                        | `true`                         | Show tooltips on hover                                                         |
| `options`     | `ChartOptions`                   | `{}`                           | Additional Chart.js options                                                    |
| `className`   | `string`                         | `''`                           | Additional CSS classes                                                         |

### Outputs

| Event        | Type                | Description                 |
| ------------ | ------------------- | --------------------------- |
| `chartClick` | `EventEmitter<any>` | Fired when chart is clicked |
| `chartHover` | `EventEmitter<any>` | Fired when chart is hovered |

## 📝 Data Formats

### Standard Chart Data

```typescript
const chartData: ChartData = {
  labels: ["Label 1", "Label 2", "Label 3"],
  datasets: [
    {
      label: "Dataset 1",
      data: [10, 20, 30],
      // Optional customizations
      backgroundColor: "#ff6384",
      borderColor: "#ff6384",
      borderWidth: 2,
    },
  ],
};
```

### Scatter Chart Data

```typescript
const scatterData: ChartData = {
  datasets: [
    {
      label: "Dataset 1",
      data: [
        { x: 10, y: 20 },
        { x: 15, y: 35 },
        { x: 25, y: 30 },
      ],
    },
  ],
};
```

### Bubble Chart Data

```typescript
const bubbleData: ChartData = {
  datasets: [
    {
      label: "Dataset 1",
      data: [
        { x: 20, y: 30, r: 15 }, // x, y, radius
        { x: 40, y: 50, r: 20 },
        { x: 30, y: 40, r: 12 },
      ],
    },
  ],
};
```

## 🎯 Advanced Examples

### Multi-Dataset Comparison

```typescript
const comparisonData: ChartData = {
  labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  datasets: [
    {
      label: "Product A",
      data: [12000, 19000, 15000, 25000, 22000, 30000],
    },
    {
      label: "Product B",
      data: [8000, 12000, 18000, 14000, 20000, 24000],
    },
    {
      label: "Product C",
      data: [5000, 8000, 12000, 10000, 15000, 18000],
    },
  ],
};
```

### Real-time Data Updates

```typescript
export class RealTimeChartComponent {
  chartData: ChartData = {
    labels: [],
    datasets: [
      {
        label: "Live Data",
        data: [],
        borderColor: "#3b82f6",
        backgroundColor: "#3b82f620",
        tension: 0.4,
        fill: true,
      },
    ],
  };

  constructor() {
    // Simulate real-time data
    setInterval(() => {
      this.addDataPoint();
    }, 2000);
  }

  addDataPoint(): void {
    const now = new Date();
    const label = now.toLocaleTimeString();
    const value = Math.random() * 100;

    this.chartData.labels.push(label);
    this.chartData.datasets[0].data.push(value);

    // Keep only last 10 points
    if (this.chartData.labels.length > 10) {
      this.chartData.labels.shift();
      this.chartData.datasets[0].data.shift();
    }
  }
}
```

### Custom Styling

```typescript
const customOptions: ChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom",
      labels: {
        usePointStyle: true,
        padding: 20,
        font: {
          size: 14,
          weight: "bold",
        },
      },
    },
    tooltip: {
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      titleFont: {
        size: 16,
      },
      bodyFont: {
        size: 14,
      },
      padding: 12,
      cornerRadius: 8,
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      grid: {
        color: "rgba(0, 0, 0, 0.05)",
      },
      ticks: {
        font: {
          size: 12,
        },
        callback: (value) => "$" + value.toLocaleString(),
      },
    },
    x: {
      grid: {
        display: false,
      },
      ticks: {
        font: {
          size: 12,
        },
      },
    },
  },
};
```

## 🎭 Event Handling

### Click Events

```typescript
onChartClick(event: any): void {
  if (event.active && event.active.length > 0) {
    const data = event.active[0];
    const label = this.chartData.labels[data.index];
    const value = this.chartData.datasets[data.datasetIndex].data[data.index];

    console.log(`Clicked: ${label} - ${value}`);

    // Navigate to details, show modal, etc.
    this.showDetails(label, value);
  }
}
```

### Hover Events

```typescript
onChartHover(event: any): void {
  if (event.active && event.active.length > 0) {
    const data = event.active[0];
    // Update UI based on hover
    this.updateTooltip(data);
  }
}
```

## 🔧 Customization

### Custom Theme

```typescript
const customTheme: ChartTheme = {
  name: "Custom Brand",
  colors: ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7"],
  gridColor: "rgba(0, 0, 0, 0.05)",
  textColor: "#2C3E50",
  legendColor: "#34495E",
};
```

### Advanced Chart Options

```typescript
const advancedOptions: ChartOptions = {
  animation: {
    duration: 2000,
    easing: "easeInOutQuart",
    delay: (context) => {
      let delay = 0;
      if (context.type === "data" && context.mode === "default") {
        delay = context.dataIndex * 300 + context.datasetIndex * 100;
      }
      return delay;
    },
  },
  interaction: {
    mode: "nearest",
    axis: "x",
    intersect: false,
  },
  plugins: {
    title: {
      display: true,
      text: "Custom Chart Title",
      font: {
        size: 18,
        weight: "bold",
      },
      padding: 20,
    },
    subtitle: {
      display: true,
      text: "Chart subtitle description",
      font: {
        size: 14,
      },
      padding: 10,
    },
  },
};
```

## 📱 Responsive Design

The component automatically adapts to different screen sizes:

- **Small**: 150px minimum height (mobile)
- **Medium**: 200px minimum height (tablet)
- **Large**: 400px minimum height (desktop)

```typescript
// Responsive sizing based on screen size
<app-chart
  [data]="data"
  type="line"
  [size]="isMobile ? 'small' : 'large'">
</app-chart>
```

## 🚀 Performance Tips

1. **Limit Data Points**: For line charts, limit to 100-200 points for smooth performance
2. **Disable Animations**: Set `animated="false"` for real-time charts
3. **Use Throttling**: Throttle rapid data updates to 60fps
4. **Lazy Loading**: Load chart data only when component is visible

## 🐛 Troubleshooting

### Common Issues

1. **Chart Not Rendering**
   - Ensure Chart.js is properly imported in your main app
   - Check that data structure is correct
   - Verify container has proper dimensions

2. **Colors Not Applying**
   - Make sure theme is properly imported
   - Check that datasets don't have conflicting color properties

3. **Events Not Firing**
   - Ensure event handlers are properly bound
   - Check that chart data is not empty

### Debug Mode

```typescript
// Enable debug logging
<app-chart
  [data]="data"
  type="bar"
  (chartClick)="console.log('Click:', $event)"
  (chartHover)="console.log('Hover:', $event)">
</app-chart>
```

## 📚 Examples Gallery

Check out the `ChartShowcaseComponent` for a complete demonstration of all chart types, themes, and features:

```typescript
// Import the showcase component
import { ChartShowcaseComponent } from '@/shared/components/chart/chart-showcase.component';

// Use it in your app
<app-chart-showcase></app-chart-showcase>
```

## 🤝 Contributing

When adding new chart types or features:

1. Update the `ExtendedChartType` union
2. Add theme-specific configurations
3. Update the showcase component with examples
4. Test across all themes
5. Update this documentation

## 📄 License

This component is part of the Vendix project and follows the same license terms.

---

**Happy Charting! 🎨📊**

For questions or support, please refer to the main project documentation or create an issue in the repository.
