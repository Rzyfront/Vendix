import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectorComponent, IconComponent, SpinnerComponent } from '../../../../../../shared/components/index';
import { OrganizationStoresService } from '../../../stores/services/organization-stores.service';

export interface StoreOption {
  id: number;
  name: string;
  slug: string;
}

@Component({
  selector: 'app-store-binding-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, SelectorComponent, IconComponent, SpinnerComponent],
  template: `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-[var(--color-text-primary)]">
          Tienda asociada
        </label>
        @if (isLoading()) {
          <app-spinner [size]="'sm'" />
        }
      </div>

      <app-selector
        [ngModel]="selectedStoreId()"
        (ngModelChange)="onStoreChange($event)"
        [options]="storeOptions()"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        size="md"
      />

      @if (selectedStoreId() && showBindingInfo()) {
        <div class="flex items-center gap-2 p-2 bg-[var(--color-muted)]/50 rounded-lg border border-[var(--color-border)]">
          <app-icon name="link" [size]="14" class="text-[var(--color-text-secondary)]" />
          <span class="text-xs text-[var(--color-text-secondary)]">
            Este dominio se asociará con la tienda seleccionada
          </span>
        </div>
      }

      @if (!selectedStoreId() && showNoStoreHint()) {
        <div class="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <app-icon name="info" [size]="14" class="text-amber-600 dark:text-amber-400" />
          <span class="text-xs text-amber-700 dark:text-amber-300">
            Sin tienda asociada, el dominio será de la organización
          </span>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class StoreBindingPickerComponent implements OnInit {
  private storesService = inject(OrganizationStoresService);

  readonly selectedStoreId = input<number | null>(null);
  readonly disabled = input<boolean>(false);
  readonly placeholder = input<string>('Sin tienda (dominio de organización)');
  readonly showBindingInfo = input<boolean>(true);
  readonly showNoStoreHint = input<boolean>(true);

  readonly storeChange = output<number | null>();

  readonly isLoading = signal(false);
  readonly storeOptions = signal<{ value: string; label: string }[]>([]);
  private stores = signal<StoreOption[]>([]);

  ngOnInit(): void {
    this.loadStores();
  }

  private loadStores(): void {
    this.isLoading.set(true);
    this.storesService.getStores({ limit: 100 }).subscribe({
      next: (response) => {
        const rawData = response.data;
        let storeList: any[] = [];
        if (Array.isArray(rawData) && rawData.length > 0) {
          if (Array.isArray(rawData[0])) {
            storeList = rawData[0] as any[];
          } else {
            storeList = rawData as any[];
          }
        }
        this.stores.set(storeList);
        this.storeOptions.set([
          { value: '', label: 'Sin tienda asignada' },
          ...storeList.map((s: { id: number; name: string }) => ({
            value: s.id.toString(),
            label: s.name,
          })),
        ]);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.storeOptions.set([{ value: '', label: 'Error cargando tiendas' }]);
      },
    });
  }

  onStoreChange(storeId: string): void {
    const id = storeId ? parseInt(storeId, 10) : null;
    this.storeChange.emit(id);
  }

  getStoreById(id: number): StoreOption | undefined {
    const stores = this.stores() as any[];
    return stores.find((s: any) => s.id === id);
  }
}
