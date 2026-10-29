import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import {
  ScrollableTab,
  ScrollableTabsComponent,
} from '../../../../../../../shared/components/index';
import { HospitalityTraPageComponent } from '../tra-page/tra-page.component';
import { HospitalitySirePageComponent } from '../sire-page/sire-page.component';

export type HospitalityComplianceTab = 'tra' | 'sire';

const COMPLIANCE_TABS: ScrollableTab[] = [
  { id: 'tra', label: 'TRA (MinCIT)', icon: 'shield-check' },
  { id: 'sire', label: 'Planilla de viajeros (SIRE)', icon: 'globe' },
];

const DEFAULT_TAB: HospitalityComplianceTab = 'tra';

function toComplianceTab(value: string | null): HospitalityComplianceTab {
  return COMPLIANCE_TABS.some((tab) => tab.id === value)
    ? (value as HospitalityComplianceTab)
    : DEFAULT_TAB;
}

/**
 * Hospitality Suite (H4.2) — "Cumplimiento": the TRA (H4.1) and the SIRE
 * (H4.2) as tabs of one menu entry. The active tab lives in `?tab=` so a
 * reload or a shared link reopens it; each tab mounts its own list page.
 */
@Component({
  selector: 'app-hospitality-compliance-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollableTabsComponent, HospitalityTraPageComponent, HospitalitySirePageComponent],
  template: `
    <div class="w-full md:space-y-4">
      <app-scrollable-tabs
        ariaLabel="Cumplimiento"
        [tabs]="tabs"
        [activeTab]="tab()"
        (tabChange)="onTab($event)"
      />

      <div role="tabpanel" [attr.aria-label]="tabLabel()">
        @switch (tab()) {
          @case ('tra') {
            <app-hospitality-tra-page />
          }
          @case ('sire') {
            <app-hospitality-sire-page />
          }
        }
      </div>
    </div>
  `,
})
export class HospitalityCompliancePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly tabs = COMPLIANCE_TABS;

  readonly tab = toSignal(
    this.route.queryParamMap.pipe(map((params) => toComplianceTab(params.get('tab')))),
    { initialValue: toComplianceTab(this.route.snapshot.queryParamMap.get('tab')) },
  );

  readonly tabLabel = computed(
    () => COMPLIANCE_TABS.find((tab) => tab.id === this.tab())?.label ?? '',
  );

  constructor() {
    if (this.route.snapshot.queryParamMap.get('tab') !== this.tab()) {
      this.selectTab(this.tab(), true);
    }
  }

  onTab(id: string): void {
    const tab = toComplianceTab(id);
    if (tab === this.tab()) return;
    this.selectTab(tab, false);
  }

  private selectTab(tab: HospitalityComplianceTab, replaceUrl: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }
}
