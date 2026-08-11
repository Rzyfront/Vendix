import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  PanelUiModulesEditorComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  TENANT_CAPABILITY,
  tenantApiUrl,
} from '../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../state/tenant-context.store';

/** Los dos árboles que declara `APP_MODULES`. */
type PanelUiAppType = 'STORE_ADMIN' | 'ORG_ADMIN';

const APP_TYPE_LABELS: Readonly<Record<PanelUiAppType, string>> = {
  STORE_ADMIN: 'Panel de tienda',
  ORG_ADMIN: 'Panel de organización',
};

interface TenantSettingsEnvelope {
  readonly level: 'store' | 'organization';
  readonly settings: Record<string, unknown>;
}

interface TenantSettingsResponse {
  readonly data?: TenantSettingsEnvelope;
}

type PanelUiMap = Record<string, Record<string, boolean>>;

/**
 * Módulos visibles del tenant — techo de `store_settings.settings.panel_ui`.
 *
 * REUTILIZA `app-panel-ui-modules-editor`, el mismo editor que usan el panel del
 * comerciante y los modales de usuario. No se escribe un editor nuevo: el árbol
 * de módulos, la cascada padre/hijo y el gating ya viven ahí, y una segunda
 * copia divergiría el día que se añada un módulo.
 *
 * `readOnly` es un input que el compartido YA tiene: en solo lectura deshabilita
 * los toggles preservando su valor, en vez de pintarlos apagados —que sería
 * mentir sobre lo que hay guardado—.
 */
@Component({
  selector: 'app-tenant-modules',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    PanelUiModulesEditorComponent,
  ],
  template: `
    <div class="space-y-3 md:space-y-4">
      @if (levelNotice(); as notice) {
        <app-alert-banner variant="info" icon="info">
          {{ notice }}
        </app-alert-banner>
      }

      <app-alert-banner variant="warning" icon="alert-triangle">
        Este mapa es el techo de VISIBILIDAD del panel, no una autorización. Un
        módulo apagado aquí desaparece del menú, pero el backend sigue
        aceptando sus peticiones si el rol del usuario tiene el permiso.
      </app-alert-banner>

      @if (loading()) {
        <app-card [responsive]="true">
          <div class="flex items-center justify-center gap-3 py-10">
            <div
              class="h-6 w-6 animate-spin rounded-full border-b-2 border-primary"
            ></div>
            <p class="text-sm text-text-secondary">Cargando módulos…</p>
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
            <p class="max-w-md text-sm text-text-secondary">{{ loadError() }}</p>
            <app-button variant="outline" size="sm" (clicked)="load()">
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Reintentar
            </app-button>
          </div>
        </app-card>
      } @else {
        <app-card [responsive]="true">
          <div class="space-y-4">
            <header
              class="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3"
            >
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-text-primary">
                  Módulos del panel
                </h2>
                <p class="mt-0.5 text-xs text-text-secondary">
                  {{ APP_TYPE_LABELS[appType()] }} ·
                  {{ enabledCount() }} de {{ totalCount() }} visibles
                </p>
              </div>

              <div class="flex items-center gap-1.5">
                @for (option of appTypeOptions; track option) {
                  <button
                    type="button"
                    class="rounded-full border px-2.5 py-1 text-xs transition-colors"
                    [class.bg-primary]="option === appType()"
                    [class.text-white]="option === appType()"
                    [class.border-primary]="option === appType()"
                    [class.border-border]="option !== appType()"
                    [class.text-text-secondary]="option !== appType()"
                    (click)="selectAppType(option)"
                  >
                    {{ APP_TYPE_LABELS[option] }}
                  </button>
                }
              </div>
            </header>

            <!-- Nunca se conmuta con [hidden]: el editor monta toggles bajo
                 @defer y un ancestro oculto los dejaría en skeleton. El
                 @if reconstruye. -->
            @if (appType(); as active) {
              <app-panel-ui-modules-editor
                [appType]="active"
                [value]="editorValue()"
                [hiddenByIndustry]="noGating"
                [hiddenByStore]="noGating"
                [searchable]="true"
                [parentSync]="true"
                [readOnly]="!canWrite()"
                (valueChange)="onModulesChange($event)"
              ></app-panel-ui-modules-editor>
            }

            <div
              class="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3"
            >
              @if (!canWrite()) {
                <p class="mr-auto text-[11px] text-text-secondary">
                  El perfil no declara <code>{{ writeCapability }}</code>: solo
                  lectura.
                </p>
              } @else if (dirty()) {
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
                [disabled]="!canWrite() || !dirty() || saving()"
                [loading]="saving()"
                (clicked)="save()"
              >
                <app-icon name="save" [size]="16" slot="icon"></app-icon>
                Guardar módulos
              </app-button>
            </div>
          </div>
        </app-card>
      }
    </div>
  `,
})
export class TenantModulesComponent {
  private readonly http = inject(HttpClient);
  private readonly store = inject(TenantContextStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly APP_TYPE_LABELS = APP_TYPE_LABELS;
  protected readonly writeCapability = TENANT_CAPABILITY.settingsWrite;
  protected readonly appTypeOptions: PanelUiAppType[] = [
    'STORE_ADMIN',
    'ORG_ADMIN',
  ];

  /**
   * El techo por industria (`stores.industries` → `INDUSTRY_HIDDEN_MODULES`) NO
   * viaja en el perfil del tenant, así que aquí no se puede pintar. Se pasa
   * vacío a propósito en vez de inventarlo: el gating por industria se aplica
   * igualmente en el lado del comerciante al leer el menú, y el valor que se
   * persiste desde aquí es el techo de tienda, que es una dimensión distinta.
   */
  protected readonly noGating: string[] = [];

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly envelope = signal<TenantSettingsEnvelope | null>(null);

  protected readonly appType = signal<PanelUiAppType>('STORE_ADMIN');

  /** Mapa completo persistido, por app_type. Es la base de la fusión al guardar. */
  private readonly persisted = signal<PanelUiMap>({});
  /** Borrador del app_type activo. */
  protected readonly editorValue = signal<Record<string, boolean>>({});
  private readonly pristineJson = signal('{}');

  protected readonly canWrite = computed(() =>
    this.store.can(TENANT_CAPABILITY.settingsWrite),
  );

  protected readonly dirty = computed(
    () => JSON.stringify(this.editorValue()) !== this.pristineJson(),
  );

  protected readonly totalCount = computed(
    () => Object.keys(this.editorValue()).length,
  );

  protected readonly enabledCount = computed(
    () =>
      Object.values(this.editorValue()).filter((value) => value !== false)
        .length,
  );

  protected readonly levelNotice = computed<string | null>(() => {
    const data = this.envelope();
    if (!data) return null;
    if (data.level === 'organization' && this.store.scope === 'stores') {
      return (
        'Los ajustes de este tenant cuelgan de la organización: el mapa de módulos que se ' +
        'edita aquí alcanza a todas sus tiendas, no sólo a la que nombra la URL.'
      );
    }
    return null;
  });

  constructor() {
    this.appType.set(this.store.isOrganization() ? 'ORG_ADMIN' : 'STORE_ADMIN');
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
          this.persisted.set(this.readPanelUi(data));
          this.hydrateDraft();
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.envelope.set(null);
          this.loadError.set(
            extractApiErrorMessage(err) ||
              'No se pudo cargar el mapa de módulos del tenant.',
          );
        },
      });
  }

  protected selectAppType(next: PanelUiAppType): void {
    if (next === this.appType()) return;
    if (this.dirty()) {
      this.toast.warning(
        'Guarda o descarta los cambios antes de cambiar de panel.',
      );
      return;
    }
    this.appType.set(next);
    this.hydrateDraft();
  }

  protected onModulesChange(next: Record<string, boolean>): void {
    this.editorValue.set({ ...next });
  }

  protected revert(): void {
    this.hydrateDraft();
  }

  protected save(): void {
    if (!this.canWrite() || this.saving()) return;

    const appType = this.appType();
    // Se fusiona sobre el mapa persistido para no borrar el otro app_type: el
    // editor sólo conoce las claves del árbol activo.
    const merged: PanelUiMap = {
      ...this.persisted(),
      [appType]: { ...this.editorValue() },
    };

    this.saving.set(true);
    this.http
      .patch<TenantSettingsResponse>(tenantApiUrl(this.store, 'settings'), {
        settings: { panel_ui: merged },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          const data = response?.data ?? null;
          if (data) {
            this.envelope.set(data);
            // Se rehidrata desde la respuesta, no desde lo enviado: el saneador
            // del backend puede recortar y afirmar lo contrario sería mentir.
            this.persisted.set(this.readPanelUi(data));
            this.hydrateDraft();
          }
          this.toast.success('Módulos del tenant actualizados');
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo actualizar el mapa de módulos',
          );
        },
      });
  }

  private hydrateDraft(): void {
    const value = { ...(this.persisted()[this.appType()] ?? {}) };
    this.editorValue.set(value);
    this.pristineJson.set(JSON.stringify(value));
  }

  private readPanelUi(data: TenantSettingsEnvelope | null): PanelUiMap {
    const raw = data?.settings?.['panel_ui'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

    const result: PanelUiMap = {};
    for (const [appType, modules] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
        continue;
      }
      const entries: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(
        modules as Record<string, unknown>,
      )) {
        entries[key] = value !== false;
      }
      result[appType] = entries;
    }
    return result;
  }
}
