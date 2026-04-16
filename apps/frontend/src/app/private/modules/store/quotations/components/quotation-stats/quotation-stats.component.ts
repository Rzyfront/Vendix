import { Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { QuotationStats } from '../../interfaces/quotation.interface';

@Component({
  selector: 'app-quotation-stats',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="stats-scroll-container">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Cotizaciones</div>
          <div class="stat-value">{{ stats().total }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Pendientes</div>
          <div class="stat-value text-warning">{{ stats().pending }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tasa de Conversión</div>
          <div class="stat-value text-success">{{ stats().conversion_rate }}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Valor Promedio</div>
          <div class="stat-value">\${{ stats().average_value | number:'1.0-0' }}</div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .stats-scroll-container {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding: 0.25rem 0;
    }
    .stats-scroll-container::-webkit-scrollbar { display: none; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      min-width: 600px;
    }
    .stat-card {
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e2e8f0);
      border-radius: 0.5rem;
      padding: 1rem;
    }
    .stat-label {
      font-size: 0.75rem;
      color: var(--text-muted, #999);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text, #222);
      margin-top: 0.25rem;
    }
    .text-warning { color: #f59e0b; }
    .text-success { color: #10b981; }
    @media (max-width: 640px) {
      .stats-grid {
        grid-template-columns: repeat(4, minmax(140px, 1fr));
      }
    }
  `],
})
export class QuotationStatsComponent {
  readonly stats = input<QuotationStats>({
    total: 0, pending: 0, conversion_rate: 0, average_value: 0,
    draft: 0, sent: 0, accepted: 0, converted: 0,
  });
}
