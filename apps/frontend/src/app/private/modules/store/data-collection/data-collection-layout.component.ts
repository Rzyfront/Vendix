import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-data-collection-layout',
  standalone: true,
  imports: [RouterModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <!-- Tab Navigation -->
      <div class="border-b px-4 sm:px-6" style="border-color: var(--color-border); background: var(--color-surface)">
        <nav class="flex gap-1 -mb-px overflow-x-auto">
          @for (tab of tabs; track tab.route) {
            <a [routerLink]="tab.route"
               routerLinkActive="active-tab"
               class="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 border-transparent whitespace-nowrap transition-colors"
               [style.color]="'var(--color-text-muted)'"
               [routerLinkActiveOptions]="{ exact: false }">
              <app-icon [name]="tab.icon" [size]="15"></app-icon>
              {{ tab.label }}
            </a>
          }
        </nav>
      </div>

      <!-- Page Content -->
      <router-outlet />
    </div>
  `,
  styles: [`
    :host ::ng-deep .active-tab {
      border-bottom-color: var(--color-primary) !important;
      color: var(--color-primary) !important;
    }
  `],
})
export class DataCollectionLayoutComponent {
  tabs = [
    { label: 'Campos', icon: 'database', route: './fields' },
    { label: 'Plantillas', icon: 'layout-template', route: './templates' },
    { label: 'Formularios', icon: 'inbox', route: './submissions' },
  ];
}
