import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { debounceTime, switchMap } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  ModalComponent,
  IconComponent,
  BadgeComponent,
} from '../../../../../shared/components';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-partner-toggle-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, IconComponent, BadgeComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      title="Convertir organización en partner"
      size="lg"
      (closed)="onClose()"
    >
      <div class="space-y-3">
        <p class="text-sm text-text-secondary">
          Selecciona una organización existente para activarla como partner. Podrás definir el margen y las personalizaciones después en el detalle del partner.
        </p>

        <div class="relative">
          <app-icon name="search" [size]="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"></app-icon>
          <input
            type="text"
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Buscar por nombre o slug…"
            [ngModel]="searchTerm()"
            (ngModelChange)="onSearch($event)"
          />
        </div>

        @if (loading()) {
          <div class="text-center text-sm text-text-secondary py-4">Cargando…</div>
        } @else if (results().length === 0) {
          <div class="text-center text-sm text-text-secondary py-4">No hay organizaciones que coincidan.</div>
        } @else {
          <div class="space-y-2 max-h-72 overflow-y-auto">
            @for (org of results(); track org.id) {
              <button
                type="button"
                class="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-background-alt text-left transition-colors disabled:opacity-50"
                [disabled]="org.is_partner || isSaving(org.id)"
                (click)="convert(org)"
              >
                <div>
                  <div class="font-medium text-text-primary text-sm">{{ org.name }}</div>
                  <div class="text-xs text-text-secondary">{{ org.slug }}</div>
                </div>
                <div class="flex items-center gap-2">
                  @if (org.is_partner) {
                    <app-badge>Ya es partner</app-badge>
                  } @else if (isSaving(org.id)) {
                    <span class="text-xs text-text-secondary">Convirtiendo…</span>
                  } @else {
                    <app-icon name="arrow-right" [size]="16"></app-icon>
                  }
                </div>
              </button>
            }
          </div>
        }
      </div>
    </app-modal>
  `,
})
export class PartnerToggleModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly closed = output<void>();
  readonly toggled = output<any>();

  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  readonly searchTerm = signal('');
  readonly results = signal<any[]>([]);
  readonly loading = signal(false);
  readonly saving = signal<string | null>(null);

  private search$ = new Subject<string>();

  isSaving(id: string | number): boolean {
    return this.saving() === String(id);
  }

  constructor() {
    this.search$
      .pipe(
        debounceTime(400),
        switchMap((term) => {
          this.loading.set(true);
          const params = new URLSearchParams({ search: term, limit: '20' });
          return this.http.get<any>(`${environment.apiUrl}/superadmin/organizations?${params.toString()}`);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.results.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    // Initial fetch
    this.search$.next('');
  }

  onSearch(term: string) {
    this.searchTerm.set(term);
    this.search$.next(term);
  }

  convert(org: any) {
    if (org.is_partner) return;
    this.saving.set(String(org.id));
    this.http
      .patch<any>(`${environment.apiUrl}/superadmin/subscriptions/partners/toggle`, {
        organization_id: org.id,
        is_partner: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(null);
          this.toast.show({ variant: 'success', description: `${org.name} ahora es partner` });
          this.toggled.emit(res?.data ?? org);
          this.onClose();
        },
        error: () => {
          this.saving.set(null);
          this.toast.show({ variant: 'error', description: 'No se pudo convertir en partner' });
        },
      });
  }

  onClose() {
    this.closed.emit();
  }
}
