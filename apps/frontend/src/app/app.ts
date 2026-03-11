import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable, Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { ConfigFacade } from './core/store/config';
import { CardComponent } from './shared/components/card/card.component';
import { SpinnerComponent } from './shared/components/spinner/spinner.component';
import { ToastContainerComponent } from './shared/components/toast/toast-container.component';
import { GlobalUserModalsComponent } from './shared/components/global-user-modals/global-user-modals.component';
// Chart.js registration removed (migrated to ECharts)

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    CommonModule,
    CardComponent,
    SpinnerComponent,
    ToastContainerComponent,
    GlobalUserModalsComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  protected title = 'vendix';

  public readonly isLoading$: Observable<boolean>;
  public readonly error$: Observable<any>;

  private configFacade = inject(ConfigFacade);
  private gateSubscription?: Subscription;

  constructor() {
    this.isLoading$ = this.configFacade.isLoading$;
    this.error$ = this.configFacade.error$;
  }

  ngOnInit(): void {
    this.removePrerenderGate();
  }

  ngOnDestroy(): void {
    this.gateSubscription?.unsubscribe();
  }

  /** Remove the prerender gate once Angular finishes initializing */
  private removePrerenderGate(): void {
    if (typeof document === 'undefined') return;

    this.gateSubscription = this.isLoading$
      .pipe(
        filter((loading) => !loading),
        take(1),
      )
      .subscribe(() => {
        document.documentElement.classList.remove('vendix-prerender-hidden');
        document.getElementById('vendix-prerender-gate')?.remove();
        document.querySelector('.vendix-gate-spinner')?.remove();
      });
  }
}
