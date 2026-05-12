import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../shared/components';

@Component({
  selector: 'app-subscriptions-layout',
  standalone: true,
  imports: [RouterModule, IconComponent],
  template: `
    <div class="w-full">
      <div class="bg-surface border-b border-border mb-4">
        <div class="flex items-center gap-1 overflow-x-auto px-2 py-2 md:px-6 md:py-3">
          <a
            routerLink="plans"
            routerLinkActive="text-primary border-b-2 border-primary"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary whitespace-nowrap hover:text-text-primary transition-colors"
          >
            <app-icon name="clipboard-list" [size]="16"></app-icon>
            Planes
          </a>
          <a
            routerLink="partners"
            routerLinkActive="text-primary border-b-2 border-primary"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary whitespace-nowrap hover:text-text-primary transition-colors"
          >
            <app-icon name="handshake" [size]="16"></app-icon>
            Partners
          </a>
          <a
            routerLink="promotional"
            routerLinkActive="text-primary border-b-2 border-primary"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary whitespace-nowrap hover:text-text-primary transition-colors"
          >
            <app-icon name="tag" [size]="16"></app-icon>
            Promos
          </a>
          <a
            routerLink="active"
            routerLinkActive="text-primary border-b-2 border-primary"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary whitespace-nowrap hover:text-text-primary transition-colors"
          >
            <app-icon name="credit-card" [size]="16"></app-icon>
            Activas
          </a>
          <a
            routerLink="dunning"
            routerLinkActive="text-primary border-b-2 border-primary"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary whitespace-nowrap hover:text-text-primary transition-colors"
          >
            <app-icon name="alert-triangle" [size]="16"></app-icon>
            Cobranza
          </a>
          <a
            routerLink="payouts"
            routerLinkActive="text-primary border-b-2 border-primary"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary whitespace-nowrap hover:text-text-primary transition-colors"
          >
            <app-icon name="banknote" [size]="16"></app-icon>
            Pagos
          </a>
          <a
            routerLink="events"
            routerLinkActive="text-primary border-b-2 border-primary"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary whitespace-nowrap hover:text-text-primary transition-colors"
          >
            <app-icon name="activity" [size]="16"></app-icon>
            Eventos
          </a>
          <a
            routerLink="gateway"
            routerLinkActive="text-primary border-b-2 border-primary"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary whitespace-nowrap hover:text-text-primary transition-colors"
          >
            <app-icon name="shield-check" [size]="16"></app-icon>
            Pasarela
          </a>
          <a
            routerLink="metrics"
            routerLinkActive="text-primary border-b-2 border-primary"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary whitespace-nowrap hover:text-text-primary transition-colors"
          >
            <app-icon name="chart-line" [size]="16"></app-icon>
            Métricas
          </a>
        </div>
      </div>
      <router-outlet></router-outlet>
    </div>
  `,
})
export class SubscriptionsLayoutComponent {}
