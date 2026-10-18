import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../../../../environments/environment';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  BadgeComponent,
} from '../../../../../../shared/components';

export interface ServiceSessionRow {
  id: number;
  status: string;
  opened_at: string;
  station_name: string;
  product_name: string;
  subject?: { label: string } | null;
}

@Component({
  selector: 'app-service-sessions-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    ButtonComponent,
    IconComponent,
    BadgeComponent,
  ],
  templateUrl: './service-sessions-panel.component.html',
  styleUrl: './service-sessions-panel.component.scss',
})
export class ServiceSessionsPanelComponent {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/store/service-sessions`;

  readonly sessions = signal<ServiceSessionRow[]>([]);
  readonly selected = signal<ServiceSessionRow | null>(null);
  readonly budget = signal<any>(null);
  readonly proposals = signal<any[]>([]);
  readonly amount = signal<number | null>(null);
  readonly saving = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.http.get<any>(this.api).subscribe({
      next: (r) => {
        this.sessions.set(r?.data ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las atenciones activas.');
        this.loading.set(false);
      },
    });
  }

  open(session: ServiceSessionRow): void {
    this.selected.set(session);
    this.error.set('');
    this.http.get<any>(`${this.api}/${session.id}/budget`).subscribe({
      next: (r) => {
        const value = r?.data ?? null;
        this.budget.set(value);
        this.amount.set(value ? Number(value.amount) : null);
      },
      error: () => this.error.set('No se pudo cargar el presupuesto.'),
    });
    this.http.get<any>(`${this.api}/${session.id}/proposals`).subscribe({
      next: (r) => this.proposals.set(r?.data ?? []),
      error: () => this.proposals.set([]),
    });
  }

  saveBudget(): void {
    const session = this.selected();
    const amount = this.amount();
    if (!session || amount == null || amount < 0) return;
    this.saving.set(true);
    this.http
      .put<any>(`${this.api}/${session.id}/budget`, {
        amount,
        currency: this.budget()?.currency || 'COP',
        expectedVersion: this.budget()?.version ?? 0,
      })
      .subscribe({
        next: (r) => {
          this.budget.set(r?.data ?? r);
          this.saving.set(false);
          this.open(session);
        },
        error: () => {
          this.error.set('No se pudo guardar el presupuesto. Recarga e intenta de nuevo.');
          this.saving.set(false);
        },
      });
  }

  transition(action: 'pause' | 'resume' | 'close'): void {
    const session = this.selected();
    if (!session) return;
    this.http.patch<any>(`${this.api}/${session.id}`, { action }).subscribe({
      next: () => {
        this.selected.set(null);
        this.load();
      },
      error: () => this.error.set('No se pudo actualizar el estado de la atención.'),
    });
  }
}
