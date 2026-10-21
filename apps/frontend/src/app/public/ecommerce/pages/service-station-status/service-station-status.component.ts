import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Meta } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../environments/environment';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface StationStatus { station: string; state: 'available' | 'occupied' | 'paused'; service: string | null; opened_at?: string; currency?: string; items: Array<{ name: string; quantity: number; total: string }>; total: string; }
@Component({
  selector: 'app-service-station-status', standalone: true, imports: [CommonModule, IconComponent],
  template: `<main class="mx-auto max-w-xl p-5 pt-12"><section class="rounded-2xl border bg-surface p-6 shadow-sm">
    @if (state() === 'loading') { <p class="py-10 text-center">Consultando estación…</p> }
    @else if (state() === 'unavailable') { <p class="py-10 text-center">Este QR no está disponible.</p> }
    @else if (station(); as info) {
      <div class="text-center"><app-icon name="warehouse" [size]="32"/><h1 class="mt-3 text-2xl font-bold">{{ info.station }}</h1>
        <p class="mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold" [class.bg-emerald-100]="info.state === 'available'" [class.text-emerald-800]="info.state === 'available'" [class.bg-amber-100]="info.state !== 'available'">{{ info.state === 'available' ? 'Disponible' : info.state === 'paused' ? 'En pausa' : 'En servicio' }}</p>
      </div>
      @if (info.service) { <div class="mt-6 border-t pt-4"><h2 class="font-semibold">Trabajo en curso</h2><p class="mt-1">{{ info.service }}</p>
        @if (info.items.length) { <ul class="mt-4 divide-y">@for (item of info.items; track $index) { <li class="flex justify-between py-2 text-sm"><span>{{ item.name }} × {{ item.quantity }}</span><span>{{ item.total | currency:info.currency:'symbol':'1.0-0' }}</span></li> }</ul> }
        <p class="mt-3 flex justify-between border-t pt-3 font-bold"><span>Total acumulado</span><span>{{ info.total | currency:info.currency:'symbol':'1.0-0' }}</span></p>
      </div> }
      <p class="mt-6 text-center text-xs text-[var(--color-text-secondary)]">Información de la estación y del trabajo. No se muestran datos personales.</p>
    }
  </section></main>`
})
export class ServiceStationStatusComponent implements OnInit {
  private readonly http = inject(HttpClient); private readonly route = inject(ActivatedRoute); private readonly meta = inject(Meta); private readonly destroyRef = inject(DestroyRef);
  readonly station = signal<StationStatus | null>(null); readonly state = signal<'loading'|'loaded'|'unavailable'>('loading');
  private id = '';
  ngOnInit(): void { this.meta.updateTag({ name: 'referrer', content: 'no-referrer' }); this.id = this.route.snapshot.paramMap.get('publicId') ?? ''; if (!/^[0-9a-f-]{36}$/i.test(this.id)) { this.state.set('unavailable'); return; } this.refresh(); const timer = setInterval(() => this.refresh(), 15000); this.destroyRef.onDestroy(() => clearInterval(timer)); }
  private refresh(): void { this.http.get<StationStatus>(`${environment.apiUrl}/ecommerce/service-sessions/station/${encodeURIComponent(this.id)}`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: value => { this.station.set(value); this.state.set('loaded'); }, error: () => this.state.set('unavailable') }); }
}
