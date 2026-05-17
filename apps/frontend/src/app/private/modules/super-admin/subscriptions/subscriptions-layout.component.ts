import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../shared/components/sticky-header/sticky-header.component';

@Component({
  selector: 'app-subscriptions-layout',
  standalone: true,
  imports: [RouterModule, StickyHeaderComponent],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Suscripciones"
        subtitle="Planes, partners, pagos, cobranza y métricas de la plataforma"
        icon="credit-card"
        [tabs]="tabs"
        tabsAriaLabel="Secciones de suscripciones"
      ></app-sticky-header>

      <router-outlet></router-outlet>
    </div>
  `,
})
export class SubscriptionsLayoutComponent {
  readonly tabs: StickyHeaderTab[] = [
    { id: 'plans', route: 'plans', label: 'Planes', icon: 'clipboard-list' },
    { id: 'partners', route: 'partners', label: 'Partners', shortLabel: 'Partners', icon: 'users' },
    { id: 'promotional', route: 'promotional', label: 'Promos', icon: 'tag' },
    { id: 'active', route: 'active', label: 'Suscripciones', shortLabel: 'Activas', icon: 'credit-card' },
    { id: 'dunning', route: 'dunning', label: 'Cobranza', shortLabel: 'Cobro', icon: 'alert-triangle' },
    { id: 'payouts', route: 'payouts', label: 'Pagos', icon: 'banknote' },
    { id: 'events', route: 'events', label: 'Eventos', icon: 'activity' },
    { id: 'gateway', route: 'gateway', label: 'Pasarela', shortLabel: 'Pasarela', icon: 'shield-check' },
    { id: 'metrics', route: 'metrics', label: 'Métricas', shortLabel: 'Métricas', icon: 'chart-line' },
  ];
}
