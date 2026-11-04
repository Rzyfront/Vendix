import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import type { ProductPageCustomDomain, StoreAppDetail } from '../interfaces/store-app.interface';
import { APP_PAGE_VARIANTS, AppPageVariant, PageAppKind } from '../templates';

/**
 * F6-B — the part of "General" every app page shares: whether the app is on,
 * where it is published (its fixed address or one of the store's domains)
 * and the ready-made templates. What is specific to each app (which apps the
 * store home lists, the featured product…) is projected below it.
 *
 * Publishing is not here: it lives once, in the view header.
 */
@Component({
  selector: 'app-app-page-general-panel',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4" data-testid="app-page-general-panel">
      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Estado</h3>
            <p class="mt-1 text-sm text-[var(--color-text-primary)]" data-testid="app-page-status-label">{{ statusLabel() }}</p>
          </div>
          @if (detail()?.status === 'draft') {
            <button type="button" class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
                    [disabled]="busy()" (click)="power.emit('deactivate')" data-testid="app-page-deactivate">
              <app-icon name="power" [size]="14" /> Apagar
            </button>
          } @else if (isOff()) {
            <button type="button" class="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text-on-primary,#fff)] disabled:opacity-50"
                    [disabled]="busy()" (click)="power.emit('activate')" data-testid="app-page-activate">
              <app-icon name="power" [size]="14" /> Encender
            </button>
          }
        </div>
        @if (detail()?.status === 'published') {
          <p class="mt-2 text-xs text-[var(--color-text-secondary)]">Para apagarla, primero despublícala desde la barra superior.</p>
        }
      </section>

      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="app-page-domain">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Dónde se publica</h3>
        @if (domains(); as list) {
          <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
            La dirección de Vendix queda siempre activa. Si eliges uno de tus dominios, se suma como alias al publicar.
          </p>
          <label class="mt-2 flex items-start gap-2 text-sm">
            <input type="radio" name="apb-domain" [checked]="customDomainId() === null" (change)="customDomainId.set(null)" />
            <span>{{ addressHint() }}</span>
          </label>
          @for (d of list; track d.id) {
            <label class="mt-2 flex items-start gap-2 text-sm">
              <input type="radio" name="apb-domain" [checked]="customDomainId() === d.id" (change)="customDomainId.set(d.id)"
                     [attr.data-testid]="'app-page-domain-' + d.id" />
              <span>{{ d.hostname }}</span>
            </label>
          }
        } @else {
          <p class="mt-1 text-sm text-[var(--color-text-primary)]">{{ addressHint() }}</p>
        }
      </section>

      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="app-page-templates">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Plantillas</h3>
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Cambian la portada, las secciones y el estilo. Tus datos de contacto, SEO y WhatsApp se quedan.</p>
        <div class="mt-3 grid gap-2 sm:grid-cols-3">
          @for (variant of variants(); track variant.id) {
            <div class="rounded-lg border border-[var(--color-border)] p-3">
              <p class="text-sm font-medium text-[var(--color-text-primary)]">{{ variant.name }}</p>
              <p class="mt-0.5 text-xs text-[var(--color-text-secondary)]">{{ variant.description }}</p>
              @if (confirming() === variant.id) {
                <div class="mt-2 flex flex-wrap gap-2" [attr.data-testid]="'app-page-template-confirm-' + variant.id">
                  <button type="button" class="rounded-lg bg-[var(--color-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-on-primary,#fff)]"
                          (click)="confirming.set(null); applyTemplate.emit(variant)">Reemplazar</button>
                  <button type="button" class="rounded-lg px-2.5 py-1 text-xs text-[var(--color-text-secondary)]" (click)="confirming.set(null)">Cancelar</button>
                </div>
              } @else {
                <button type="button" class="mt-2 text-xs font-semibold text-[var(--color-primary)]"
                        [attr.data-testid]="'app-page-template-' + variant.id" (click)="confirming.set(variant.id)">Usar esta plantilla</button>
              }
            </div>
          }
        </div>
      </section>

      <ng-content />
    </div>
  `,
})
export class AppPageGeneralPanelComponent {
  readonly kind = input.required<PageAppKind>();
  readonly detail = input<StoreAppDetail | null>(null);
  readonly busy = input(false);
  /** The store's own domains; `null` when the app has a fixed address. */
  readonly domains = input<readonly ProductPageCustomDomain[] | null>(null);
  readonly addressHint = input('');
  readonly customDomainId = model<number | null>(null);

  readonly power = output<'activate' | 'deactivate'>();
  readonly applyTemplate = output<AppPageVariant>();

  readonly confirming = signal<string | null>(null);
  readonly variants = computed(() => APP_PAGE_VARIANTS[this.kind()]);

  readonly isOff = computed(() => {
    const status = this.detail()?.status;
    return status === 'not_installed' || status === 'disabled';
  });
  readonly statusLabel = computed(() => {
    const app = this.detail();
    if (!app) return '';
    if (app.status === 'published') return app.domain ? `Publicada en ${app.domain.hostname}` : 'Publicada';
    if (app.status === 'draft') return 'Encendida, sin publicar';
    if (app.status === 'disabled') return 'Apagada';
    return 'Sin instalar';
  });
}
