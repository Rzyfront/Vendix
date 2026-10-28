import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import {
  ScrollableTab,
  ScrollableTabsComponent,
} from '../../../../../../../shared/components/index';
import { HospitalityCancellationsPageComponent } from '../../../reservations/pages/cancellations-page/cancellations-page.component';
import { HospitalityNightAuditPageComponent } from '../../../reservations/pages/night-audit-page/night-audit-page.component';
import { HospitalityPerformancePageComponent } from '../../../reservations/pages/performance-page/performance-page.component';
import { HospitalityPickupPageComponent } from '../../../reservations/pages/pickup-page/pickup-page.component';

export type HospitalityReportTab = 'night-audit' | 'performance' | 'pickup' | 'cancellations';

const REPORT_TABS: ScrollableTab[] = [
  { id: 'night-audit', label: 'Cierre del día', icon: 'moon' },
  { id: 'performance', label: 'Indicadores', icon: 'chart-line' },
  { id: 'pickup', label: 'Ritmo de reservas', icon: 'calendar-clock' },
  { id: 'cancellations', label: 'Cancelaciones y no presentados', icon: 'calendar-x' },
];

const DEFAULT_TAB: HospitalityReportTab = 'night-audit';

function toReportTab(value: string | null): HospitalityReportTab {
  return REPORT_TABS.some((tab) => tab.id === value)
    ? (value as HospitalityReportTab)
    : DEFAULT_TAB;
}

/**
 * Hospitality Suite — R4. "Reportes de hotel": one menu entry with the four
 * hotel reports as tabs. The active tab lives in `?tab=` so a reload or a
 * shared link reopens the same report; each tab mounts the existing report
 * page untouched (its own four stats, sticky search and options dropdown).
 */
@Component({
  selector: 'app-hospitality-reports-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScrollableTabsComponent,
    HospitalityNightAuditPageComponent,
    HospitalityPerformancePageComponent,
    HospitalityPickupPageComponent,
    HospitalityCancellationsPageComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <app-scrollable-tabs
        ariaLabel="Reportes de hotel"
        [tabs]="tabs"
        [activeTab]="tab()"
        (tabChange)="onTab($event)"
      />

      <div role="tabpanel" [attr.aria-label]="tabLabel()">
        @switch (tab()) {
          @case ('night-audit') {
            <app-hospitality-night-audit-page />
          }
          @case ('performance') {
            <app-hospitality-performance-page />
          }
          @case ('pickup') {
            <app-hospitality-pickup-page />
          }
          @case ('cancellations') {
            <app-hospitality-cancellations-page />
          }
        }
      </div>
    </div>
  `,
})
export class HospitalityReportsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly tabs = REPORT_TABS;

  // Read from the router (not a local signal) so back/forward and the old
  // report URLs, which redirect here with `?tab=`, switch the tab too.
  readonly tab = toSignal(
    this.route.queryParamMap.pipe(map((params) => toReportTab(params.get('tab')))),
    { initialValue: toReportTab(this.route.snapshot.queryParamMap.get('tab')) },
  );

  readonly tabLabel = computed(
    () => REPORT_TABS.find((tab) => tab.id === this.tab())?.label ?? '',
  );

  constructor() {
    // The menu entry opens the bare URL: write the default (or a corrected
    // unknown) tab into it without adding a history entry.
    if (this.route.snapshot.queryParamMap.get('tab') !== this.tab()) {
      this.selectTab(this.tab(), true);
    }
  }

  onTab(id: string): void {
    const tab = toReportTab(id);
    if (tab === this.tab()) return;
    this.selectTab(tab, false);
  }

  private selectTab(tab: HospitalityReportTab, replaceUrl: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }
}
