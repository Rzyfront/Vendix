import {
  Component,
  input,
  signal,
  ElementRef,
  inject,
  afterNextRender,
  computed,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AnalyticsView } from '../../config/analytics-registry';

@Component({
  selector: 'app-analytics-tab-bar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './analytics-tab-bar.component.html',
  styleUrls: ['./analytics-tab-bar.component.scss'],
})
export class AnalyticsTabBarComponent {
  private elementRef = inject(ElementRef);
  private router = inject(Router);

  readonly tabs = input.required<AnalyticsView[]>();
  readonly showFadeLeft = signal(false);
  readonly showFadeRight = signal(false);

  private hasInitialized = false;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  constructor() {
    afterNextRender(() => {
      this.setupScrollListener();
      this.checkScroll();
      this.hasInitialized = true;
      this.scrollToActive();
    });
  }

  private setupScrollListener(): void {
    const el = this.elementRef.nativeElement.querySelector('.tabs-container');
    if (!el) return;

    el.addEventListener('scroll', () => {
      this.checkScroll();
    }, { passive: true });
  }

  private checkScroll(): void {
    const el = this.elementRef.nativeElement.querySelector('.tabs-container');
    if (!el) return;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    this.showFadeLeft.set(scrollLeft > 0);
    this.showFadeRight.set(scrollLeft < scrollWidth - clientWidth - 1);
  }

  scrollToActive(): void {
    const el = this.elementRef.nativeElement.querySelector('.tab-button.active');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  trackByViewKey(index: number, tab: AnalyticsView): string {
    return tab.key;
  }

  isActive = (route: string): boolean => {
    const url = this.currentUrl();
    return url === route || url.startsWith(route + '/') || url.startsWith(route + '?');
  };
}