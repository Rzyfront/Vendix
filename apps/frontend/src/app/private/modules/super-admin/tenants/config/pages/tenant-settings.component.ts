import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { startWith } from 'rxjs/operators';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  EmptyStateComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  TENANT_CAPABILITY,
  tenantApiUrl,
} from '../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../state/tenant-context.store';

/**
 * Respuesta de `GET/PATCH /superadmin/tenants/:scope/:id/settings`.
 *
 * `level` no es decorativo: en una organización que factura con NIT único el
 * backend lee y escribe en `organization_settings` aunque la URL nombre una
 * tienda. Sin ese dato la consola afirmaría estar editando una tienda mientras
 * toca la organización entera.
 */
interface TenantSettingsEnvelope {
  readonly level: 'store' | 'organization';
  readonly organization_id: number | null;
  readonly store_id: number | null;
  readonly fiscal_scope: 'STORE' | 'ORGANIZATION';
  readonly settings: Record<string, unknown>;
}

interface TenantSettingsResponse {
  readonly data?: TenantSettingsEnvelope;
}

/**
 * Secciones que el saneador del backend conserva (`KNOWN_SECTIONS` de
 * `store/settings/settings.service.ts`). Una sección fuera de esta lista se
 * descarta EN SILENCIO y el PATCH responde 200 igual, así que la consola avisa
 * antes de dejar creer que el cambio se guardó.
 */
const KNOWN_SECTIONS: ReadonlySet<string> = new Set([
  'general',
  'inventory',
  'checkout',
  'notifications',
  'pos',
  'receipts',
  'branding',
  'fonts',
  'publication',
  'operations',
  'panel_ui',
  'ecommerce',
  'module_flows',
  'fiscal_status',
  'fiscal_data',
  'dispatch',
  'restaurant',
  'membership',
  'services',
  'reservations',
  'availability',
]);

/**
 * Secciones con superficie dedicada en otra pestaña. Se listan igual —esconder
 * datos del tenant nunca ayuda a soporte— pero el editor crudo se niega a
 * guardarlas: hay un formulario que aplica las reglas de dominio.
 */
const DELEGATED_SECTIONS: Readonly<Record<string, string>> = {
  panel_ui: 'Módulos',
  fiscal_data: 'Identidad fiscal',
};

/**
 * Ajustes del tenant: navegador de secciones con edición cruda por sección.
 *
 * POR QUÉ UN EDITOR POR SECCIÓN Y NO UN FORMULARIO: `store_settings.settings`
 * son ~20 secciones heterogéneas cuyo formulario canónico ya existe en el panel
 * del comerciante. Reimplementarlo aquí crearía una segunda verdad que se
 * desincroniza. El `PATCH` del rail fusiona por sección de primer nivel y pasa
 * por el MISMO `sanitizeAndValidate` y los mismos guards de transición que el
 * comerciante, así que enviar una sección completa es el contrato exacto que el
 * backend espera — ni más, ni menos.
 */
@Component({
  selector: 'app-tenant-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    EmptyStateComponent,
    IconComponent,
  ],
  template: `
    <div class="space-y-3 md:space-y-4">
      @if (levelNotice(); as notice) {
        <app-alert-banner variant="info" icon="info">
          {{ notice }}
        </app-alert-banner>
      }

      @if (loading()) {
        <app-card [responsive]="true">
          <div class="flex items-center justify-center gap-3 py-10">
            <div
              class="h-6 w-6 animate-spin rounded-full border-b-2 border-primary"
            ></div>
            <p class="text-sm text-text-secondary">Cargando ajustes…</p>
          </div>
        </app-card>
      } @else if (loadError()) {
        <app-card [responsive]="true">
          <div class="flex flex-col items-center gap-3 py-8 text-center">
            <app-icon
              name="alert-triangle"
              [size]="22"
              class="text-red-600"
            ></app-icon>
            <p class="max-w-md text-sm text-text-secondary">
              {{ loadError() }}
            </p>
            <app-button variant="outline" size="sm" (clicked)="load()">
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Reintentar
            </app-button>
          </div>
        </app-card>
      } @else if (!sections().length) {
        <app-card [responsive]="true">
          <app-empty-state
            icon="sliders-horizontal"
            size="sm"
            title="Sin ajustes guardados"
            description="Este tenant nunca ha persistido configuración: el backend responde con un objeto vacío."
            [showActionButton]="false"
          ></app-empty-state>
        </app-card>
      } @else {
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-[240px_1fr] lg:gap-4">
          <!-- Índice de secciones -->
          <app-card [responsive]="true" [padding]="false">
            <nav class="flex flex-col p-2" aria-label="Secciones de ajustes">
              @for (section of sections(); track section) {
                <button
                  type="button"
                  class="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
                  [class.bg-primary-100]="section === activeSection()"
                  [class.font-semibold]="section === activeSection()"
                  [class.text-text-primary]="section === activeSection()"
                  [class.text-text-secondary]="section !== activeSection()"
                  (click)="selectSection(section)"
                >
                  <span class="truncate">{{ section }}</span>
                  @if (delegatedTo(section); as owner) {
                    <app-badge variant="neutral" size="xs">{{ owner }}</app-badge>
                  } @else if (!isKnown(section)) {
                    <app-badge variant="warning" size="xs">?</app-badge>
                  }
                </button>
              }
            </nav>
          </app-card>

          <!-- Editor de la sección activa -->
          <app-card [responsive]="true">
            @if (activeSection(); as section) {
              <div class="space-y-3">
                <header class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <h2 class="text-base font-semibold text-text-primary">
                      {{ section }}
                    </h2>
                    <p class="mt-0.5 text-xs text-text-secondary">
                      Se envía como un PATCH de
                      <code class="rounded bg-background px-1 py-0.5">
                        settings.{{ section }}
                      </code>
                      — las demás secciones no se tocan.
                    </p>
                  </div>
                  <app-badge
                    [variant]="isKnown(section) ? 'neutral' : 'warning'"
                    size="sm"
                  >
                    {{ isKnown(section) ? 'Sección conocida' : 'Sección no reconocida' }}
                  </app-badge>
                </header>

                @if (delegatedTo(section); as owner) {
                  <app-alert-banner variant="warning" icon="alert-triangle">
                    Esta sección tiene formulario propio en la pestaña «{{ owner }}»,
                    que aplica sus reglas de dominio. Aquí se muestra en solo
                    lectura para no crear un segundo camino de escritura.
                  </app-alert-banner>
                } @else if (!isKnown(section)) {
                  <app-alert-banner variant="warning" icon="alert-triangle">
                    El saneador del backend descarta esta clave y responde 200 de
                    todos modos: guardar aquí no persistiría nada.
                  </app-alert-banner>
                }

                <textarea
                  [formControl]="draft"
                  rows="18"
                  spellcheck="false"
                  class="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] disabled:opacity-60"
                  [attr.aria-label]="'JSON de la sección ' + section"
                ></textarea>

                @if (parseError(); as message) {
                  <p class="flex items-center gap-1.5 text-xs text-red-600">
                    <app-icon name="alert-triangle" [size]="14"></app-icon>
                    {{ message }}
                  </p>
                }

                <div class="flex flex-wrap items-center justify-end gap-2">
                  @if (dirty()) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      [disabled]="saving()"
                      (clicked)="revert()"
                    >
                      Descartar cambios
                    </app-button>
                  }
                  <app-button
                    variant="primary"
                    size="sm"
                    [disabled]="!canSubmit()"
                    [loading]="saving()"
                    (clicked)="askSave()"
                  >
                    <app-icon name="save" [size]="16" slot="icon"></app-icon>
                    Guardar sección
                  </app-button>
                </div>

                @if (!canWrite()) {
                  <p class="text-right text-[11px] text-text-secondary">
                    El perfil de este tenant no declara la capacidad
                    <code>{{ writeCapability }}</code>: la consola opera en solo
                    lectura.
                  </p>
                }
              </div>
            }
          </app-card>
        </div>
      }

      @if (pendingSave(); as section) {
        <app-confirmation-modal
          [isOpen]="true"
          title="Guardar la sección del tenant"
          [message]="saveMessage(section)"
          confirmText="Guardar"
          cancelText="Cancelar"
          confirmVariant="danger"
          (confirm)="confirmSave(section)"
          (cancel)="pendingSave.set(null)"
        ></app-confirmation-modal>
      }
    </div>
  `,
})
export class TenantSettingsComponent {
  private readonly http = inject(HttpClient);
  private readonly store = inject(TenantContextStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly writeCapability = TENANT_CAPABILITY.settingsWrite;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly envelope = signal<TenantSettingsEnvelope | null>(null);
  protected readonly activeSection = signal<string | null>(null);
  protected readonly pendingSave = signal<string | null>(null);

  /** Texto original de la sección activa; el botón sólo se ofrece si difiere. */
  private readonly pristine = signal('');

  protected readonly draft = new FormControl<string>('', { nonNullable: true });

  /**
   * `computed()` NO reacciona a un `FormControl`: sus propiedades son campos
   * planos, no señales. El puente es obligatorio o el botón «Guardar» quedaría
   * congelado en su estado inicial.
   */
  private readonly draftValue = toSignal(
    this.draft.valueChanges.pipe(startWith(this.draft.value)),
    { initialValue: this.draft.value },
  );

  protected readonly canWrite = computed(() =>
    this.store.can(TENANT_CAPABILITY.settingsWrite),
  );

  protected readonly sections = computed<string[]>(() =>
    Object.keys(this.envelope()?.settings ?? {}).sort((a, b) =>
      a.localeCompare(b),
    ),
  );

  protected readonly dirty = computed(
    () => this.draftValue() !== this.pristine(),
  );

  protected readonly parseError = computed<string | null>(() => {
    const raw = this.draftValue();
    if (!raw.trim()) return 'La sección no puede quedar vacía.';
    try {
      JSON.parse(raw);
      return null;
    } catch (error) {
      return `JSON inválido: ${(error as Error).message}`;
    }
  });

  protected readonly canSubmit = computed(() => {
    const section = this.activeSection();
    if (!section) return false;
    if (!this.canWrite() || this.saving()) return false;
    if (this.delegatedTo(section) || !this.isKnown(section)) return false;
    return this.dirty() && this.parseError() === null;
  });

  /**
   * Aviso de nivel. Se pinta SIEMPRE que el nivel leído no coincida con el
   * alcance de la URL: es el caso en que soporte cree editar una tienda y en
   * realidad está tocando la organización completa.
   */
  protected readonly levelNotice = computed<string | null>(() => {
    const data = this.envelope();
    if (!data) return null;
    if (data.level === 'organization' && this.store.scope === 'stores') {
      return (
        'Esta organización factura y configura con NIT único: los ajustes se leen y se ' +
        'escriben en la organización, no en la tienda que nombra la URL. Un cambio aquí ' +
        'alcanza a todas sus tiendas.'
      );
    }
    return null;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.http
      .get<TenantSettingsResponse>(tenantApiUrl(this.store, 'settings'))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response?.data ?? null;
          this.envelope.set(data);
          this.loading.set(false);
          const first = this.sections()[0] ?? null;
          this.selectSection(this.activeSection() ?? first);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.envelope.set(null);
          this.loadError.set(
            extractApiErrorMessage(err) ||
              'No se pudieron cargar los ajustes del tenant.',
          );
        },
      });
  }

  protected selectSection(section: string | null): void {
    this.activeSection.set(section);
    if (!section) {
      this.pristine.set('');
      this.draft.setValue('');
      return;
    }
    const value = this.envelope()?.settings?.[section];
    const text = JSON.stringify(value ?? null, null, 2);
    this.pristine.set(text);
    this.draft.setValue(text);
  }

  protected revert(): void {
    this.draft.setValue(this.pristine());
  }

  protected isKnown(section: string): boolean {
    return KNOWN_SECTIONS.has(section);
  }

  protected delegatedTo(section: string): string | null {
    return DELEGATED_SECTIONS[section] ?? null;
  }

  protected askSave(): void {
    const section = this.activeSection();
    if (!section || !this.canSubmit()) return;
    this.pendingSave.set(section);
  }

  protected saveMessage(section: string): string {
    return (
      `Se reemplazará la sección «${section}» de ${this.store.tenantName()} con el JSON del editor. ` +
      'El backend la fusiona sobre las demás secciones y aplica los mismos guards de transición ' +
      'que el panel del comerciante, así que un cambio inválido se rechaza — pero uno válido y ' +
      'equivocado sí se aplica sobre datos productivos.'
    );
  }

  protected confirmSave(section: string): void {
    this.pendingSave.set(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(this.draft.value);
    } catch {
      this.toast.error('El JSON dejó de ser válido; revisa el editor.');
      return;
    }

    this.saving.set(true);
    this.http
      .patch<TenantSettingsResponse>(tenantApiUrl(this.store, 'settings'), {
        settings: { [section]: parsed },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          const data = response?.data ?? null;
          if (data) this.envelope.set(data);
          // Se repinta desde lo que el backend DEVOLVIÓ, no desde lo enviado:
          // el saneador puede haber recortado claves y mostrar el borrador
          // afirmaría que se guardó algo que no está en la base.
          this.selectSection(section);
          this.toast.success(`Sección «${section}» guardada`);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              `No se pudo guardar la sección «${section}»`,
          );
        },
      });
  }
}
