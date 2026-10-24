import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import {
  DianNumberingRangePanelComponent,
  ResolutionsInUseCardComponent,
  type FiscalDocumentType,
  type ResolutionsInUseResponse,
} from '../../../../../../../shared/components/dian';
import { ResolutionCreateComponent } from '../../resolutions/resolution-create/resolution-create.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { DianConfigApiService } from '../../../../../../../shared/services/dian';
import { hasProductionResolution } from '../activation-step.util';
import type { ActivationContext } from '../activation-wizard.model';

/**
 * Paso 5 del asistente: resoluciones de producción. El panel de rangos
 * consulta `GetNumberingRange` y aplica; los rangos no se amplían solos.
 */
@Component({
  selector: 'vendix-activation-production-ranges-step',
  standalone: true,
  imports: [
    CardComponent,
    IconComponent,
    DianNumberingRangePanelComponent,
    ResolutionsInUseCardComponent,
    ResolutionCreateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      @if (context().readOnly) {
        <div
          class="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
          role="status"
        >
          <app-icon name="lock" [size]="14" class="mr-1 inline-block"></app-icon>
          {{ context().readOnlyReason ?? 'Este paso es de solo lectura.' }}
        </div>
      }

      <app-card [responsive]="true">
        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-text-primary">
            Autorización de numeración
          </h3>
          <ol class="list-decimal space-y-1 pl-5 text-xs text-text-secondary">
            <li>
              Solicite la autorización de numeración de facturación en el portal
              Muisca de la DIAN.
            </li>
            <li>Asocie esa numeración al software que registró en el paso 2.</li>
            <li>Vuelva aquí y sincronice: traemos la numeración que la DIAN tiene para su NIT.</li>
          </ol>
          @if (done()) {
            <p class="flex items-center gap-1.5 text-sm text-text-primary">
              <app-icon name="check-circle" [size]="16" class="text-success"></app-icon>
              Ya tiene una resolución de producción activa.
            </p>
          }
        </div>
      </app-card>

      @if (!context().readOnly) {
        <app-dian-numbering-range-panel
          [configId]="context().axis?.config_id ?? null"
          (changed)="onChanged()"
        ></app-dian-numbering-range-panel>
      }

      <app-resolutions-in-use-card
        [data]="inUse()"
        [loading]="inUseLoading()"
        [canCreateSeries]="!context().readOnly"
        (createSeries)="onCreateSeries($event)"
      ></app-resolutions-in-use-card>

      <vendix-resolution-create
        [(isOpen)]="createOpen"
        [documentType]="seededType()"
        (saved)="loadInUse()"
      ></vendix-resolution-create>
    </div>
  `,
})
export class ActivationProductionRangesStepComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly context = input.required<ActivationContext>();
  readonly changed = output<void>();

  readonly inUse = signal<ResolutionsInUseResponse | null>(null);
  readonly inUseLoading = signal(false);

  readonly createOpen = signal(false);
  readonly seededType = signal<FiscalDocumentType | null>(null);

  readonly done = computed(() => hasProductionResolution(this.context().axis));

  constructor() {
    // Recarga "En uso" cuando cambian las resoluciones del eje (tras sincronizar).
    effect(() => {
      this.context().axis?.resolutions;
      untracked(() => this.loadInUse());
    });
  }

  onChanged(): void {
    this.loadInUse();
    this.changed.emit();
  }

  onCreateSeries(type: FiscalDocumentType): void {
    this.seededType.set(type);
    this.createOpen.set(true);
  }

  loadInUse(): void {
    this.inUseLoading.set(true);
    this.api
      .getResolutionsInUse()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.inUse.set(res.data ?? null);
          this.inUseLoading.set(false);
        },
        error: () => this.inUseLoading.set(false),
      });
  }
}
