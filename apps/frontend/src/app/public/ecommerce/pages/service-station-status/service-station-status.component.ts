import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Meta } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../environments/environment';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

interface StationStatus { station: string; state: 'available' | 'occupied' | 'paused'; }
@Component({
  selector: 'app-service-station-status', standalone: true, imports: [CommonModule, IconComponent],
  template: `<main class="mx-auto max-w-xl p-5 pt-12"><section class="rounded-2xl border bg-surface p-6 shadow-sm">
    @if (state() === 'loading') { <p class="py-10 text-center">Consultando estación…</p> }
    @else if (state() === 'unavailable') { <p class="py-10 text-center">Este QR no está disponible.</p> }
    @else if (station(); as info) {
      <div class="text-center"><app-icon name="warehouse" [size]="32"/><h1 class="mt-3 text-2xl font-bold">{{ info.station }}</h1>
        <p class="mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold" [class.bg-emerald-100]="info.state === 'available'" [class.text-emerald-800]="info.state === 'available'" [class.bg-amber-100]="info.state !== 'available'">{{ info.state === 'available' ? 'Disponible' : info.state === 'paused' ? 'En pausa' : 'En servicio' }}</p>
      </div>
      <p class="mt-6 text-center text-xs text-[var(--color-text-secondary)]">Estado de la estación. No se muestran datos personales.</p>
    }
  </section></main>`
})
export class ServiceStationStatusComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly meta = inject(Meta);
  private readonly destroyRef = inject(DestroyRef);
  readonly station = signal<StationStatus | null>(null);
  readonly state = signal<'loading' | 'loaded' | 'unavailable'>('loading');
  private id = '';
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.meta.updateTag({ name: 'referrer', content: 'no-referrer' });
    this.id = this.route.snapshot.paramMap.get('publicId') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(this.id)) {
      this.state.set('unavailable');
      return;
    }
    this.refresh();
    this.timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      this.refresh();
    }, 15000);
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.meta.removeTag("name='referrer'");
  }

  private stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private refresh(): void {
    if (this.inFlight) return;
    this.inFlight = true;
    this.http
      .get<StationStatus>(`${environment.apiUrl}/ecommerce/service-sessions/station/${encodeURIComponent(this.id)}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (value) => {
          this.inFlight = false;
          this.station.set({ station: value.station, state: value.state });
          this.state.set('loaded');
        },
        error: (err) => {
          this.inFlight = false;
          // Un fallo transitorio conserva la última foto; 404/410 invalidan el QR y paran el polling.
          if (err?.status === 404 || err?.status === 410) {
            this.stopPolling();
            this.state.set('unavailable');
          } else if (!this.station()) {
            this.state.set('unavailable');
          }
        },
      });
  }
}
