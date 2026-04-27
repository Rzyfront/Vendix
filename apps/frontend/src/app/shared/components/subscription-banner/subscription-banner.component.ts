import {
  Component,
  inject,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { SubscriptionFacade } from '../../../core/store/subscription';
import { IconComponent } from '../icon/icon.component';

type BannerLevel = 'none' | 'info' | 'warning' | 'danger';

interface BannerCopy {
  title: string;
  detail: string;
  ctaText: string;
  iconName: string;
}

@Component({
  selector: 'app-subscription-banner',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    @if (visible()) {
      <div class="sub-banner" [class]="'sub-banner--' + level()" role="status">
        <div class="sub-banner__inner">
          <span class="sub-banner__icon" aria-hidden="true">
            <app-icon [name]="copy().iconName" [size]="18" />
          </span>
          <div class="sub-banner__text">
            <span class="sub-banner__title">{{ copy().title }}</span>
            @if (copy().detail) {
              <span class="sub-banner__detail">{{ copy().detail }}</span>
            }
          </div>
          <a
            [routerLink]="ctaLink()"
            class="sub-banner__cta"
            [attr.aria-label]="copy().ctaText"
          >
            {{ copy().ctaText }}
            <app-icon name="chevron-right" [size]="14" />
          </a>
          <button
            type="button"
            class="sub-banner__dismiss"
            (click)="onDismiss()"
            aria-label="Cerrar aviso"
          >
            <app-icon name="close" [size]="16" />
          </button>
        </div>
      </div>
    }
  `,
  styleUrl: './subscription-banner.component.css',
})
export class SubscriptionBannerComponent {
  private readonly facade = inject(SubscriptionFacade);
  private readonly router = inject(Router);

  private readonly dismissed = signal(false);

  readonly level = computed<BannerLevel>(() => this.facade.bannerLevel());

  readonly visible = computed(
    () => !this.dismissed() && this.level() !== 'none',
  );

  readonly copy = computed<BannerCopy>(() => {
    const status = this.facade.status();
    const days = this.facade.daysUntilDue();
    switch (this.level()) {
      case 'info':
        return {
          title: 'Tu suscripción está activa',
          detail: days > 0 ? `Próxima renovación en ${days} días.` : '',
          ctaText: 'Gestionar',
          iconName: 'shield-check',
        };
      case 'warning':
        return {
          title: status === 'grace_hard'
            ? 'Tu suscripción entró en período de gracia'
            : 'Tu suscripción vence pronto',
          detail: days > 0
            ? `Te quedan ${days} días. Renueva para evitar interrupciones.`
            : 'Renueva ahora para evitar interrupciones en tu servicio.',
          ctaText: 'Pagar ahora',
          iconName: 'alert-triangle',
        };
      case 'danger':
        return {
          title: status === 'grace_hard' || status === 'grace_soft'
            ? 'Tu suscripción está en período de gracia'
            : 'Tu suscripción está vencida',
          detail: 'Regulariza el pago para recuperar el acceso completo.',
          ctaText: 'Regularizar',
          iconName: 'alert-octagon',
        };
      default:
        return { title: '', detail: '', ctaText: '', iconName: 'info' };
    }
  });

  readonly ctaLink = computed(() => {
    const url = this.router.url;
    if (url.includes('super-admin')) return '/super-admin/subscriptions/active';
    if (url.includes('admin') && !url.includes('store')) return '/admin/subscriptions';
    return '/admin/subscription/payment';
  });

  onDismiss(): void {
    this.dismissed.set(true);
  }
}
