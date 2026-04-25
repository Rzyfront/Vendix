import {
  Component,
  inject,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { SubscriptionFacade } from '../../../core/store/subscription';

@Component({
  selector: 'app-subscription-banner',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    @if (visible()) {
      <div [class]="bannerClass()">
        <div class="flex items-center justify-between px-4 py-2">
          <span>{{ message() }}</span>
          <a [routerLink]="ctaLink()" class="underline font-medium">{{ ctaText() }}</a>
        </div>
      </div>
    }
  `,
  styleUrl: './subscription-banner.component.css',
})
export class SubscriptionBannerComponent {
  private facade = inject(SubscriptionFacade);
  private router = inject(Router);

  readonly visible = computed(() => this.facade.bannerLevel() !== 'none');
  readonly bannerClass = computed(() => {
    const level = this.facade.bannerLevel();
    switch (level) {
      case 'info': return 'bg-blue-50 text-blue-800 border-b border-blue-200';
      case 'warning': return 'bg-yellow-50 text-yellow-800 border-b border-yellow-200';
      case 'danger': return 'bg-red-50 text-red-800 border-b border-red-200';
      default: return '';
    }
  });
  readonly message = computed(() => {
    const level = this.facade.bannerLevel();
    switch (level) {
      case 'info': return 'Tu suscripción está activa.';
      case 'warning': return 'Tu suscripción vence pronto. Renueva para continuar usando IA.';
      case 'danger': return 'Tu suscripción está vencida. Renueva ahora para recuperar el acceso a IA.';
      default: return '';
    }
  });
  readonly ctaLink = computed(() => {
    const url = this.router.url;
    if (url.includes('super-admin')) return '/super-admin/subscriptions/active';
    if (url.includes('admin') && !url.includes('store')) return '/admin/subscriptions';
    return '/admin/subscription';
  });
  readonly ctaText = computed(() => 'Gestionar suscripción');
}
