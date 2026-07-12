import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import {
  ExogenousValidationError,
  ExogenousValidationResult,
} from '../interfaces/exogenous.interface';

interface ValidationErrorGroup {
  type: string;
  label: string;
  errors: ExogenousValidationError[];
}

@Component({
  selector: 'app-exogenous-validation-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (validation(); as v) {
      @if (v.is_complete) {
        <!-- Complete: green banner -->
        <div class="flex items-center gap-3 rounded-lg border border-success-light bg-success-light p-4 mt-4">
          <app-icon name="shield-check" [size]="22" class="text-success shrink-0"></app-icon>
          <div>
            <p class="text-sm font-medium text-success">
              Datos completos para el año {{ v.fiscal_year }}
            </p>
            <p class="text-xs text-success mt-0.5">
              No se encontraron errores de completitud. Puede generar los formatos de exógena.
            </p>
          </div>
        </div>
      } @else {
        <!-- Incomplete: amber banner + grouped errors -->
        <div class="rounded-lg border border-warning-light bg-warning-light mt-4">
          <div class="flex items-center gap-3 p-4 border-b border-warning-light">
            <app-icon name="alert-triangle" [size]="22" class="text-warning shrink-0"></app-icon>
            <div>
              <p class="text-sm font-medium text-warning">
                Se encontraron {{ v.error_count }} errores de completitud para el año {{ v.fiscal_year }}
              </p>
              <p class="text-xs text-warning mt-0.5">
                Corrija los datos faltantes antes de generar o enviar los formatos.
              </p>
            </div>
          </div>
          <div class="p-4 space-y-4">
            @for (group of errorGroups(); track group.type) {
              <div>
                <div class="flex items-center gap-2 mb-2">
                  <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-warning-light text-warning">
                    {{ group.label }}
                  </span>
                  <span class="text-xs text-text-secondary">{{ group.errors.length }} registro(s)</span>
                </div>
                <ul class="space-y-1">
                  @for (error of group.errors; track $index) {
                    <li class="text-sm text-text-primary flex items-start gap-2">
                      <span class="text-warning mt-0.5">&bull;</span>
                      <span>
                        {{ error.detail }}
                        <span class="text-xs text-text-secondary ml-1">({{ error.resource }} #{{ error.resource_id }})</span>
                      </span>
                    </li>
                  }
                </ul>
              </div>
            }
          </div>
        </div>
      }
    }
  `,
})
export class ExogenousValidationPanelComponent {
  readonly validation = input<ExogenousValidationResult | null>(null);

  private readonly typeLabels: Record<string, string> = {
    missing_nit: 'NIT faltante',
    missing_document: 'Documento faltante',
    missing_name: 'Nombre faltante',
    missing_address: 'Dirección faltante',
    missing_municipality: 'Municipio faltante',
    invalid_nit: 'NIT inválido',
  };

  readonly errorGroups = computed<ValidationErrorGroup[]>(() => {
    const v = this.validation();
    if (!v?.errors?.length) return [];
    const map = new Map<string, ExogenousValidationError[]>();
    for (const error of v.errors) {
      const list = map.get(error.type) ?? [];
      list.push(error);
      map.set(error.type, list);
    }
    return Array.from(map.entries()).map(([type, errors]) => ({
      type,
      label: this.typeLabels[type] ?? type,
      errors,
    }));
  });
}
