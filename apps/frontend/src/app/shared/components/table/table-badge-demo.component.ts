import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableComponent, TableColumn } from './table.component';

@Component({
  selector: 'app-table-badge-demo',
  standalone: true,
  imports: [CommonModule, TableComponent],
  template: `
    <h2>Ejemplo de Tabla con Badges Dinámicos</h2>
    <app-table
      [data]="tableData"
      [columns]="tableColumns"
      [size]="'md'"
      [striped]="true"
      [hoverable]="true"
    >
    </app-table>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 20px;
      }

      h2 {
        margin-bottom: 20px;
      }
    `,
  ],
})
export class TableBadgeDemoComponent {
  tableData = [
    {
      id: 1,
      name: 'Producto A',
      status: 'active',
      category: 'electronics',
      priority: 'high',
      rating: 4.5,
    },
    {
      id: 2,
      name: 'Producto B',
      status: 'inactive',
      category: 'clothing',
      priority: 'medium',
      rating: 3.8,
    },
    {
      id: 3,
      name: 'Producto C',
      status: 'suspended',
      category: 'books',
      priority: 'low',
      rating: 4.2,
    },
    {
      id: 4,
      name: 'Producto D',
      status: 'draft',
      category: 'home',
      priority: 'high',
      rating: 4.0,
    },
    {
      id: 5,
      name: 'Producto E',
      status: 'pending',
      category: 'sports',
      priority: 'medium',
      rating: 3.5,
    },
  ];

  tableColumns: TableColumn[] = [
    {
      key: 'id',
      label: 'ID',
      align: 'center',
    },
    {
      key: 'name',
      label: 'Nombre',
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'status',
      },
    },
    {
      key: 'category',
      label: 'Categoría',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          electronics: '#6366f1',
          clothing: '#10b981',
          books: '#f59e0b',
          home: '#ef4444',
          sports: '#8b5cf6',
        },
      },
    },
    {
      key: 'priority',
      label: 'Prioridad',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          high: '#ef4444',
          medium: '#f59e0b',
          low: '#10b981',
        },
      },
    },
    {
      key: 'rating',
      label: 'Calificación',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          high: '#10b981', // Green for high ratings (4-5)
          medium: '#f59e0b', // Amber for medium ratings (3-4)
          low: '#ef4444', // Red for low ratings (0-3)
        },
      },
      // We'll handle the rating to category mapping in the template or component
      transform: (value: number) => {
        // Return the display value
        return `${value.toFixed(1)} ★`;
      },
    },
  ];
}
