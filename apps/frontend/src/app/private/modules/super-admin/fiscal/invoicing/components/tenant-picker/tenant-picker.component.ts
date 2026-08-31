import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { environment } from '../../../../../../../../environments/environment';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputsearchComponent,
  SelectorComponent,
} from '../../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import { PlatformAcquirer } from '../../state';

interface SearchResponse {
  success: boolean;
  data: {
    data: PlatformAcquirer[];
    meta?: { q: string | null; kind: string | null };
  };
  message?: string;
}

@Component({
  selector: 'app-platform-tenant-picker',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    SelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @if (selectedTenant(); as tenant) {
        <!-- Estado: Destinatario Seleccionado -->
        <div class="rounded-xl border border-primary/20 bg-primary/5 p-4 transition-all">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-start gap-3">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
                <app-icon [name]="tenant.kind === 'organization' ? 'building' : tenant.kind === 'user' ? 'user' : 'store'" [size]="20" />
              </div>
              <div class="space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-bold text-text-primary">
                    {{ tenant.legal_name || tenant.name }}
                  </span>
                  <app-badge [variant]="tenant.kind === 'organization' ? 'service' : tenant.kind === 'user' ? 'neutral' : 'primary'" size="sm">
                    {{ tenant.kind === 'organization' ? 'Organización' : tenant.kind === 'user' ? 'Usuario' : 'Tienda' }}
                  </app-badge>
                  @if (tenant.fiscal_data_complete) {
                    <app-badge variant="success" size="sm">
                      <app-icon slot="icon" name="check" [size]="12" />
                      Datos fiscales OK
                    </app-badge>
                  } @else {
                    <app-badge variant="warning" size="sm">
                      <app-icon slot="icon" name="alert-triangle" [size]="12" />
                      Datos fiscales incompletos
                    </app-badge>
                  }
                </div>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                  <span>
                    <strong class="text-text-primary font-medium">NIT/Doc:</strong>
                    {{ tenant.tax_id || 'Sin NIT' }}{{ tenant.tax_id_dv ? '-' + tenant.tax_id_dv : '' }}
                  </span>
                  @if (tenant.email) {
                    <span>
                      <strong class="text-text-primary font-medium">Correo:</strong>
                      {{ tenant.email }}
                    </span>
                  }
                  @if (tenant.address.city || tenant.address.department_code) {
                    <span>
                      <strong class="text-text-primary font-medium">Ubicación:</strong>
                      {{ tenant.address.city || tenant.address.department_code }}
                    </span>
                  }
                </div>
              </div>
            </div>

            <app-button
              type="button"
              variant="outline"
              size="sm"
              class="self-start sm:self-center shrink-0"
              (clicked)="clearSelection()"
            >
              <app-icon slot="icon" name="refresh-cw" [size]="14" />
              Cambiar cliente
            </app-button>
          </div>
        </div>
      } @else {
        <!-- Estado: Búsqueda Interactiva -->
        <div class="space-y-2 relative">
          <div class="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-2">
            <!--
              Buscador del sistema en lugar del <input> suelto que había acá:
              trae el icono, el botón de limpiar, los tamaños y el foco del
              resto del panel. El debounce se deja en 0 a propósito porque el
              pipeline de este componente ya tiene su propio debounceTime(250);
              con los dos activos la lista tardaba medio segundo largo en
              moverse y parecía colgada.
            -->
            <app-inputsearch
              type="search"
              size="sm"
              placeholder="Buscar por nombre, razón social, NIT o slug..."
              [debounceTime]="0"
              [ngModel]="searchQuery()"
              (searchChange)="onSearchChange($event)"
              (focus)="onInputFocus()"
              (clear)="onClearQuery()"
            ></app-inputsearch>

            <app-selector
              [options]="kindOptions"
              [ngModel]="selectedKind()"
              (ngModelChange)="onKindChange($event)"
            ></app-selector>
          </div>

          <!--
            Lista de resultados EN FLUJO, no flotante.

            Antes era un absolute z-50 y no se veía nunca: el
            app-platform-section-wrapper que la contiene lleva
            overflow-hidden para redondear sus esquinas, y eso recorta a
            cualquier descendiente posicionado que se salga de la caja. El
            z-index no salva de un recorte por overflow — el apilado y el
            clipping son cosas distintas. Poner la lista en flujo la vuelve
            inmune al overflow de CUALQUIER ancestro, presente o futuro, que
            es lo que un dropdown flotante dentro de un acordeón no puede
            garantizar.
          -->
          @if (isOpen()) {
            <div
              class="bg-surface border border-border rounded-xl shadow-sm max-h-72 overflow-y-auto divide-y divide-border"
            >
              @if (loading()) {
                <div class="flex items-center justify-center gap-2 p-4 text-xs text-text-secondary">
                  <app-icon name="loader-2" [size]="16" class="animate-spin text-primary" />
                  Buscando clientes...
                </div>
              } @else if (searchError(); as err) {
                <div class="p-4 space-y-2">
                  <div class="flex items-start gap-2 text-xs text-danger">
                    <app-icon name="alert-triangle" [size]="16" class="shrink-0 mt-0.5" />
                    <span>{{ err }}</span>
                  </div>
                  <button
                    type="button"
                    class="text-xs font-semibold text-primary hover:underline"
                    (click)="triggerSearch()"
                  >
                    Reintentar
                  </button>
                </div>
              } @else if (results().length === 0) {
                <div class="p-4 text-center text-xs text-text-secondary">
                  @if (searchQuery().trim().length > 0) {
                    No se encontraron tiendas u organizaciones que coincidan con "{{ searchQuery() }}".
                  } @else {
                    No hay registros disponibles para el filtro seleccionado.
                  }
                </div>
              } @else {
                <div class="py-1">
                  @for (tenant of results(); track tenant.id) {
                    <button
                      type="button"
                      class="w-full text-left px-4 py-3 hover:bg-surface-secondary/70 transition-colors flex items-center justify-between gap-3 group"
                      (click)="selectTenant(tenant)"
                    >
                      <div class="space-y-0.5 flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-sm font-semibold text-text-primary group-hover:text-primary transition-colors truncate">
                            {{ tenant.legal_name || tenant.name }}
                          </span>
                          <app-badge [variant]="tenant.kind === 'organization' ? 'service' : 'primary'" size="xsm">
                            {{ tenant.kind === 'organization' ? 'Org' : 'Tienda' }}
                          </app-badge>
                          @if (!tenant.fiscal_data_complete) {
                            <app-badge variant="warning" size="xsm">Incompleto</app-badge>
                          }
                        </div>
                        <div class="flex items-center gap-3 text-xs text-text-secondary truncate">
                          <span>
                            NIT: {{ tenant.tax_id || '—' }}{{ tenant.tax_id_dv ? '-' + tenant.tax_id_dv : '' }}
                          </span>
                          @if (tenant.address.city) {
                            <span>· {{ tenant.address.city }}</span>
                          }
                          @if (tenant.email) {
                            <span class="hidden sm:inline">· {{ tenant.email }}</span>
                          }
                        </div>
                      </div>

                      <div class="text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        Seleccionar →
                      </div>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class TenantPickerComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  private readonly searchSubject$ = new Subject<{ q: string; kind: string }>();

  readonly searchQuery = signal<string>('');
  readonly selectedKind = signal<string>('');
  readonly results = signal<PlatformAcquirer[]>([]);
  readonly loading = signal<boolean>(false);
  /** Motivo por el que la última búsqueda falló. Vacío mientras vaya bien. */
  readonly searchError = signal<string>('');
  /**
   * La lista arranca ABIERTA. Mientras no haya destinatario elegido, la lista
   * ES el contenido de la sección: arrancar cerrada dejaba un buscador mudo
   * que sólo reaccionaba al foco, y el operador no tenía forma de saber que
   * había algo que elegir.
   */
  readonly isOpen = signal<boolean>(true);
  readonly selectedTenant = signal<PlatformAcquirer | null>(null);

  readonly tenantPicked = output<PlatformAcquirer | null>();

  readonly kindOptions: SelectorOption[] = [
    { value: '', label: 'Todos los tipos' },
    { value: 'store', label: 'Solo Tiendas' },
    { value: 'organization', label: 'Solo Organizaciones' },
    { value: 'user', label: 'Solo Usuarios' },
  ];

  ngOnInit(): void {
    // Pipeline de búsqueda reactivo con debounce y cancelación de peticiones intermedias
    this.searchSubject$
      .pipe(
        debounceTime(250),
        distinctUntilChanged((prev, curr) => prev.q === curr.q && prev.kind === curr.kind),
        tap(() => {
          this.loading.set(true);
          this.searchError.set('');
        }),
        switchMap(({ q, kind }) => {
          let params = new HttpParams();
          if (q) params = params.set('q', q);
          if (kind) params = params.set('kind', kind);
          return this.http
            .get<SearchResponse>(
              `${environment.apiUrl}/superadmin/subscriptions/fiscal/customers/search`,
              { params },
            )
            .pipe(
              // Un fallo del buscador NO puede disfrazarse de «cero
              // resultados»: durante meses el endpoint devolvió 500 por una
              // relación mal nombrada en Prisma y la pantalla decía «No hay
              // registros disponibles», que es exactamente lo que se ve
              // cuando la búsqueda funciona y no hay coincidencias. El
              // operador no tenía forma de distinguir un catálogo vacío de un
              // backend caído. El error se guarda y se pinta.
              catchError((err: unknown) => {
                this.searchError.set(this.describeSearchError(err));
                return of({ success: false, data: { data: [] } } as SearchResponse);
              }),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.loading.set(false);
        const payload: any = res?.data;
        // El sobre del backend anida `data.data`, pero algunos handlers
        // devuelven el arreglo directo. Se aceptan las dos formas antes que
        // mostrar vacío por una capa de más o de menos.
        const rows: PlatformAcquirer[] = Array.isArray(payload)
          ? payload
          : (payload?.data ?? []);
        this.results.set(rows);
      });

    // Carga inicial
    this.triggerSearch();
  }

  onSearchChange(query: string): void {
    this.searchQuery.set(query ?? '');
    this.isOpen.set(true);
    this.triggerSearch();
  }

  onKindChange(kind: any): void {
    const k = (kind ?? '').toString();
    this.selectedKind.set(k);
    this.isOpen.set(true);
    this.triggerSearch();
  }

  onInputFocus(): void {
    this.isOpen.set(true);
    if (this.results().length === 0 && !this.loading()) {
      this.triggerSearch();
    }
  }

  onClearQuery(): void {
    this.searchQuery.set('');
    this.triggerSearch();
  }

  selectTenant(tenant: PlatformAcquirer): void {
    this.selectedTenant.set(tenant);
    this.isOpen.set(false);
    this.tenantPicked.emit(tenant);
  }

  clearSelection(): void {
    this.selectedTenant.set(null);
    this.searchQuery.set('');
    this.isOpen.set(true);
    this.tenantPicked.emit(null);
    this.triggerSearch();
  }

  /**
   * Motivo legible del fallo. Se prefiere el mensaje del backend sobre uno
   * inventado: es el que nombra el error real (`INVOICING_*`, validación de
   * Prisma) y el que sirve para reportarlo.
   */
  private describeSearchError(err: unknown): string {
    const e = err as any;
    const backend = e?.error?.message ?? e?.error?.error?.message;
    const detail = Array.isArray(backend) ? backend.join(' · ') : backend;
    if (detail) return `No se pudo buscar clientes: ${detail}`;
    if (e?.status === 0) {
      return 'No se pudo buscar clientes: el servidor no respondió.';
    }
    if (e?.status) {
      return `No se pudo buscar clientes (HTTP ${e.status}).`;
    }
    return 'No se pudo buscar clientes.';
  }

  triggerSearch(): void {
    this.searchSubject$.next({
      q: this.searchQuery().trim(),
      kind: this.selectedKind(),
    });
  }
}
