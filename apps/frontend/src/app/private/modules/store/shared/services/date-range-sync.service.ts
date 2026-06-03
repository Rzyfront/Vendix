import { Injectable } from '@angular/core';
import { signal, Signal } from '@angular/core';
import { DateRangeFilter } from '../../analytics/interfaces/analytics.interface';
import { getDefaultDateRange } from '../../reports/state/reports.state';

/**
 * Shared date-range sync between analytics and reports modules.
 * Analytics components write via setDateRange(); both shells read via dateRange.
 */
@Injectable({ providedIn: 'root' })
export class DateRangeSyncService {
  private readonly _dateRange = signal<DateRangeFilter>(getDefaultDateRange());
  readonly dateRange: Signal<DateRangeFilter> = this._dateRange.asReadonly();

  setDateRange(range: DateRangeFilter): void {
    this._dateRange.set(range);
  }
}
