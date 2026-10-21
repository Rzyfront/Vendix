import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../../environments/environment';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

interface Reminder {
  id: number;
  customer: { name: string; email: string | null; phone: string | null };
  product: { name: string };
  days_since: number;
  due_date: string;
  status: 'pending' | 'sent' | 'dismissed';
}

@Component({
  selector: 'app-service-reminders-page',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink, ButtonComponent, CardComponent, IconComponent],
  template: `
    <main class="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <a routerLink="/admin/reservations" class="text-sm text-[var(--color-primary)]">← Reservas</a>
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div><h1 class="text-2xl font-bold">Recordatorios de servicios</h1><p class="text-sm text-[var(--color-text-secondary)]">Clientes a quienes ya les corresponde repetir un servicio recurrente.</p></div>
        <select class="rounded-lg border bg-surface px-3 py-2" [value]="filter()" (change)="setFilter($any($event.target).value)">
          <option value="pending">Pendientes</option><option value="sent">Enviados</option><option value="dismissed">Descartados</option><option value="all">Todos</option>
        </select>
      </header>
      @if (loading()) { <p class="py-8 text-center">Cargando recordatorios…</p> }
      @else if (!items().length) { <app-card><div class="p-8 text-center"><app-icon name="bell" [size]="28"/><p class="mt-3 font-semibold">No hay recordatorios en esta vista</p><p class="text-sm text-[var(--color-text-secondary)]">Al completar un servicio recurrente, aparecerá aquí cuando llegue su fecha.</p></div></app-card> }
      @else { <section class="grid gap-3">@for (item of items(); track item.id) {
        <app-card><article class="flex flex-col justify-between gap-4 p-4 md:flex-row md:items-center">
          <div><h2 class="font-semibold">{{ item.customer.name }}</h2><p class="text-sm">{{ item.product.name }} · {{ item.days_since }} días desde el último servicio</p><p class="text-xs text-[var(--color-text-secondary)]">Corresponde desde {{ item.due_date | date:'mediumDate' }}</p></div>
          @if (item.status === 'pending') { <div class="flex flex-wrap gap-2">
            <app-button size="sm" variant="outline" [disabled]="!item.customer.phone" (clicked)="whatsapp(item)">WhatsApp</app-button>
            <app-button size="sm" variant="outline" [disabled]="!item.customer.email" (clicked)="email(item)">Correo</app-button>
            <app-button size="sm" variant="ghost" (clicked)="dismiss(item)">Descartar</app-button>
          </div> } @else { <span class="rounded-full bg-[var(--color-background)] px-3 py-1 text-xs">{{ item.status === 'sent' ? 'Contactado' : 'Descartado' }}</span> }
        </article></app-card>
      }</section> }
    </main>
  `,
})
export class ServiceRemindersPageComponent {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly endpoint = `${environment.apiUrl}/store/service-reminders`;
  readonly items = signal<Reminder[]>([]);
  readonly loading = signal(false);
  readonly filter = signal('pending');

  constructor() { this.load(); }
  setFilter(value: string): void { this.filter.set(value); this.load(); }
  load(): void {
    this.loading.set(true);
    this.http.get<any>(this.endpoint, { params: { status: this.filter(), limit: '100' } }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => { const result = response?.data ?? response; this.items.set(result?.items ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); this.toast.error('No se pudieron cargar los recordatorios'); },
    });
  }
  whatsapp(item: Reminder): void {
    this.http.post<any>(`${this.endpoint}/${item.id}/whatsapp`, {}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => { const url = (response?.data ?? response)?.url; if (url) window.open(url, '_blank', 'noopener'); this.load(); },
      error: (error: any) => this.toast.error(error?.error?.message || 'No se pudo preparar WhatsApp'),
    });
  }
  email(item: Reminder): void {
    this.http.post(`${this.endpoint}/${item.id}/email`, {}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Recordatorio enviado por correo'); this.load(); },
      error: (error: any) => this.toast.error(error?.error?.message || 'No se pudo enviar el correo'),
    });
  }
  dismiss(item: Reminder): void {
    this.http.patch(`${this.endpoint}/${item.id}/dismiss`, {}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Recordatorio descartado'); this.load(); },
      error: () => this.toast.error('No se pudo descartar el recordatorio'),
    });
  }
}
