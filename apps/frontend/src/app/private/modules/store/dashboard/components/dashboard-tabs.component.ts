import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

export interface DashboardTab {
  id: string;
  label: string;
  shortLabel: string;
  icon: string;
}

@Component({
  selector: 'app-dashboard-tabs',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="sticky top-[84px] z-10 bg-background py-2 -mx-4 px-4
                md:static md:bg-transparent md:py-0 md:mx-0 md:px-0 md:mb-4">
      <div class="flex items-center gap-1 xs:gap-1.5 sm:gap-2 overflow-x-auto scrollbar-hide">
        @for (tab of tabs(); track tab.id) {
          <button
            type="button"
            class="flex items-center gap-1 xs:gap-1.5 px-2.5 xs:px-3 sm:px-4 py-1.5 xs:py-2
                   text-[10px] xs:text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap
                   transition-all duration-150 shadow-[0_1px_4px_rgba(0,0,0,0.06)] md:shadow-none"
            [class.active-tab]="activeTab() === tab.id"
            [class.inactive-tab]="activeTab() !== tab.id"
            (click)="tabChange.emit(tab.id)"
          >
            <app-icon [name]="tab.icon" [size]="12" class="xs:hidden"></app-icon>
            <app-icon [name]="tab.icon" [size]="14" class="hidden xs:block sm:hidden"></app-icon>
            <app-icon [name]="tab.icon" [size]="16" class="hidden sm:block"></app-icon>
            <span class="sm:hidden">{{ tab.shortLabel }}</span>
            <span class="hidden sm:inline">{{ tab.label }}</span>
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .scrollbar-hide {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    .scrollbar-hide::-webkit-scrollbar {
      display: none;
    }
    .active-tab {
      background-color: var(--color-primary) !important;
      color: white !important;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
    .inactive-tab {
      background-color: var(--color-surface);
      color: var(--color-text-secondary);
    }
    .inactive-tab:hover {
      background-color: #f9fafb;
      color: var(--color-text-primary);
    }
  `],
})
export class DashboardTabsComponent {
  tabs = input.required<DashboardTab[]>();
  activeTab = input.required<string>();
  tabChange = output<string>();
}
