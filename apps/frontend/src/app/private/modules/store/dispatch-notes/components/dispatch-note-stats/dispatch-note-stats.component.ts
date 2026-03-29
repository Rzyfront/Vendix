import { Component, Input, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsComponent } from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DispatchNoteStats } from '../../interfaces/dispatch-note.interface';

@Component({
  selector: 'app-dispatch-note-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  templateUrl: './dispatch-note-stats.component.html',
  styles: [`:host { display: contents; }`],
})
export class DispatchNoteStatsComponent implements OnInit {
  private currencyService = inject(CurrencyFormatService);

  @Input() stats: DispatchNoteStats = {
    total: 0,
    draft: 0,
    confirmed: 0,
    delivered: 0,
    invoiced: 0,
    voided: 0,
  };

  @Input() loading = false;

  ngOnInit(): void {
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
