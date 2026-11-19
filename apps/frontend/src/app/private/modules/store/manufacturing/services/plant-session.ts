import { DestroyRef, Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { activeStoreId } from '../../../../../core/utils/store-scoped-cache';
import { ManufacturingPlant } from '../interfaces';
import { ManufacturingPlantsService } from './manufacturing-plants.service';
import {
  activePlants,
  plantSessionStorageKey,
  resolveSessionPlantId,
} from './plant-selection.util';

/**
 * QUI-1013 — the production session of a plant (Producción activa, Lista del
 * día). With several active plants the screen shows one plant at a time: the
 * `?plant_id=` of the URL, else the last plant used on this device (per
 * store), else the main plant. With one plant (or none) nothing is filtered.
 */
export interface PlantSession {
  /** Active plants of the store (empty outside Planta). */
  readonly plants: Signal<ManufacturingPlant[]>;
  /** `true` once the plants are known: load the day only after it. */
  readonly ready: Signal<boolean>;
  /** Plant to filter by, or `null` for the whole store. */
  readonly plantId: Signal<number | null>;
  readonly plantName: Signal<string | null>;
  /** The selector only appears with two or more active plants. */
  readonly showPicker: Signal<boolean>;
  select(plantId: number): void;
  /** `(change)` handler of the plant `<select>`. */
  selectFrom(event: Event): void;
  /** `{ plant_id }` to carry the plant to the sibling screen, or `{}`. */
  queryParams(): { plant_id?: number };
}

/**
 * Must run in an injection context (field initializer). `enabled` is false for
 * the restaurant screens, which have no plants and make no request.
 */
export function injectPlantSession(enabled: boolean): PlantSession {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const auth = inject(AuthFacade);
  const destroyRef = inject(DestroyRef);

  const plants = signal<ManufacturingPlant[]>([]);
  const ready = signal(!enabled);
  const storageKey = plantSessionStorageKey(activeStoreId(auth));
  const stored = signal<string | null>(readStorage(storageKey));
  const queryPlant = toSignal(route.queryParamMap.pipe(map((p) => p.get('plant_id'))), {
    initialValue: route.snapshot.queryParamMap.get('plant_id'),
  });

  if (enabled) {
    inject(ManufacturingPlantsService)
      .list()
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (rows) => {
          plants.set(activePlants(rows));
          ready.set(true);
        },
        // Without the plant list the session keeps working for the whole store.
        error: () => ready.set(true),
      });
  }

  const plantId = computed(() => resolveSessionPlantId(plants(), queryPlant(), stored()));

  const select = (id: number): void => {
    stored.set(String(id));
    writeStorage(storageKey, String(id));
    void router.navigate([], {
      relativeTo: route,
      queryParams: { plant_id: id },
      queryParamsHandling: 'merge',
    });
  };

  return {
    plants: plants.asReadonly(),
    ready: ready.asReadonly(),
    plantId,
    plantName: computed(() => plants().find((p) => p.id === plantId())?.name ?? null),
    showPicker: computed(() => plants().length > 1),
    select,
    selectFrom(event: Event): void {
      const id = Number((event.target as HTMLSelectElement).value);
      if (Number.isInteger(id) && id > 0) select(id);
    },
    queryParams(): { plant_id?: number } {
      const id = plantId();
      return id != null ? { plant_id: id } : {};
    },
  };
}

function readStorage(key: string | null): string | null {
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string | null, value: string): void {
  if (!key) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // No local storage: the URL still carries the plant.
  }
}
