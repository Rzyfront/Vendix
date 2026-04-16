import { Component, inject, input } from '@angular/core';
import { StatsComponent } from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DispatchNoteStats } from '../../interfaces/dispatch-note.interface';

@Component({
  selector: 'app-dispatch-note-stats',
  standalone: true,
  imports: [StatsComponent],
  templateUrl: './dispatch-note-stats.component.html',
  styles: [`:host { display: contents; }`],
})
export class DispatchNoteStatsComponent {
  private currencyService = inject(CurrencyFormatService);

  readonly stats = input<DispatchNoteStats>({
    total: 0,
    draft: 0,
    confirmed: 0,
    delivered: 0,
    invoiced: 0,
    voided: 0,
  });

  readonly loading = input<boolean>(false);

  constructor() {
    this.currencyService.loadCurrency();
  }

  formatNumber(num: number | string): string {
    const num_value = typeof num === 'string' ? parseFloat(num) : num;
    if (num_value >= 1000000) {
      return (num_value / 1000000).toFixed(1) + 'M';
    } else if (num_value >= 1000) {
      return (num_value / 1000).toFixed(1) + 'K';
    }
    return num_value.toString();
  }
}
