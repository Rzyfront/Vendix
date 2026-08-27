import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  TableAction,
  TableColumn,
} from '../../../../../../../shared/components/index';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { environment } from '../../../../../../../../environments/environment';
import { HttpErrorResponse } from '@angular/common/http';
import { ConfirmationModalComponent } from '../../../../../../../shared/components/confirmation-modal/confirmation-modal.component';

/**
 * Perfiles de facturación del riel plataforma (VENDIX_ADMIN).
 *
 * Espejo del módulo `store/invoicing/pages/invoice-profiles-page`, con
 * `context='platform'` y componentes `shared/invoice-sections/*` (move P2.1).
 * No usa NgRx: la plataforma corre sobre `PlatformInvoicingStore` (signals)
 * y un HTTP client directo. El cross-org está blindado por el servicio
 * backend (`PLATFORM_PROFILE_001` 404 si el id pertenece a otra org).
 */

interface PlatformProfileCatalogEntry {
  id: number;
  name: string;
  operation_type: string;
  is_default: boolean;
  current_version: number;
}

interface PlatformProfileDetail {
  id: number;
  organization_id: number;
  store_id: number | null;
  name: string;
  operation_type: string;
  state: 'active' | 'inactive';
  is_default: boolean;
  current_version: number;
  current_config: any;
}

interface PlatformProfileTemplate {
  key: string;
  label: string;
  description: string;
  operation_type: string;
  template_version: number;
  config: any;
}

interface PaginatedProfiles {
  data: PlatformProfileDetail[];
  meta: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-platform-profiles',
  standalone: true,
  imports: [
    RouterLink,
    CardComponent,
    ButtonComponent,
    InputsearchComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    ConfirmationModalComponent,
  ],
  template: `
    <div class="p-4">
      <app-card title="Perfiles de facturación — Plataforma" icon="file-stack">
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-3">
            <app-inputsearch
              [placeholder]="'Buscar por nombre…'"
              (searchChange)="onSearch($event)"
            ></app-inputsearch>
            <a routerLink="new">
              <app-button variant="primary" icon="plus">
                Nuevo perfil
              </app-button>
            </a>
          </div>

          <app-responsive-data-view
            [columns]="columns"
            [data]="filteredProfiles()"
            [cardConfig]="cardConfig"
            [actions]="actions"
            [loading]="loading()"
            [emptyMessage]="'No hay perfiles plataforma creados todavía.'"
            (actionClick)="onAction($event)"
          ></app-responsive-data-view>
        </div>
      </app-card>
    </div>

    <app-confirmation-modal
      [(isOpen)]="confirmDeleteOpen"
      title="Eliminar perfil"
      confirmText="Eliminar"
      confirmVariant="danger"
      [message]="
        'Esta acción borra el perfil ' +
        (profileToDelete()?.name || '') +
        ' (versión ' +
        (profileToDelete()?.current_version ?? 0) +
        ').'
      "
      (confirm)="onConfirmDelete()"
      (cancel)="onCancelDelete()"
    ></app-confirmation-modal>
  `,
})
export class PlatformProfilesComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly profiles = signal<PlatformProfileDetail[]>([]);
  readonly loading = signal(true);
  readonly searchTerm = signal('');
  readonly confirmDeleteOpen = signal(false);
  readonly profileToDelete = signal<PlatformProfileDetail | null>(null);
  readonly total = signal(0);

  readonly filteredProfiles = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.profiles();
    return this.profiles().filter((p) =>
      p.name.toLowerCase().includes(term),
    );
  });

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Nombre' },
    { key: 'operation_type', label: 'Tipo operación' },
    {
      key: 'state',
      label: 'Estado',
      transform: (v) => (v === 'active' ? 'Activo' : 'Inactivo'),
    },
    {
      key: 'is_default',
      label: 'Predeterminado',
      transform: (v) => (v ? '★' : ''),
    },
    {
      key: 'current_version',
      label: 'Versión',
      transform: (v) => `v${v}`,
    },
  ];

  /**
   * Configuración de la tarjeta que `ResponsiveDataView` exige para la vista
   * móvil. Es un input requerido: sin ella el componente no compila y la
   * lista no tiene representación fuera del escritorio.
   */
  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleTransform: (p: PlatformProfileDetail) =>
      `Tipo ${p.operation_type} · v${p.current_version}`,
  };

  readonly actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'pencil',
      action: (p: any) => this.router.navigate(['profiles', p.id, 'edit']),
    },
    {
      label: 'Eliminar',
      icon: 'trash',
      action: (p: any) => {
        this.profileToDelete.set(p);
        this.confirmDeleteOpen.set(true);
      },
    },
  ];

  constructor() {
    this.load();
  }

  onSearch(term: string) {
    this.searchTerm.set(term);
  }

  onAction(event: { action: TableAction; item: any }) {
    event.action.action?.(event.item);
  }

  onCancelDelete() {
    this.confirmDeleteOpen.set(false);
    this.profileToDelete.set(null);
  }

  onConfirmDelete() {
    const p = this.profileToDelete();
    this.confirmDeleteOpen.set(false);
    if (!p) return;
    this.http
      .delete<{ success: boolean }>(
        `${environment.apiUrl}/superadmin/subscriptions/fiscal/profiles/${p.id}`,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Perfil eliminado', p.name);
          this.load();
        },
        error: (err: HttpErrorResponse) => {
          const code = (err.error as any)?.error_code || 'ERR';
          this.toast.error(`${code}: ${err.error?.message || 'Error'}`, '');
        },
      });
  }

  private load() {
    this.loading.set(true);
    const params = new HttpParams().set('limit', '50');
    firstValueFrom(
      this.http.get<PaginatedProfiles>(
        `${environment.apiUrl}/superadmin/subscriptions/fiscal/profiles`,
        { params },
      ),
    )
      .then((resp) => {
        this.profiles.set(resp.data || []);
        this.total.set(resp.meta?.total ?? resp.data?.length ?? 0);
      })
      .catch((err: HttpErrorResponse) => {
        this.toast.error(
          `Error cargando perfiles: ${err.error?.message || err.status}`,
          '',
        );
        this.profiles.set([]);
      })
      .finally(() => this.loading.set(false));
  }
}
