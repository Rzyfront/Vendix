import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';

import { RouterModule, Router } from '@angular/router';
import { TenantFacade } from '../../../../../../app/core/store';

export interface HeroBannerConfig {
  title: string;
  subtitle: string;
  image_url?: string;
  background_color?: string;
  text_color?: string;
  cta_text: string;
  cta_link: string;
  show_overlay?: boolean;
}

export interface SliderPhoto {
  url: string | null;
  title: string;
  caption: string;
  action_type?:
    | 'none'
    | 'internal_url'
    | 'external_url'
    | 'product'
    | 'category'
    | 'brand';
  action_label?: string;
  action_url?: string;
  product_id?: number;
  category_id?: number;
  brand_id?: number;
  open_in_new_tab?: boolean;
}

@Component({
  selector: 'app-hero-banner',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './hero-banner.component.html',
  styleUrls: ['./hero-banner.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroBannerComponent implements OnInit {
  readonly banner = input<Partial<HeroBannerConfig>>({});
  readonly slides = input<SliderPhoto[]>([]);
  readonly class = input<string>('');

  readonly current_slide_index = signal(0);
  private auto_play_interval: any;

  private domain_service = inject(TenantFacade);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => this.stopAutoPlay());
  }

  ngOnInit(): void {
    if (this.slides().length > 1) {
      this.startAutoPlay();
    }
  }

  private startAutoPlay(): void {
    this.auto_play_interval = setInterval(() => {
      this.nextSlide();
    }, 5000);
  }

  private stopAutoPlay(): void {
    if (this.auto_play_interval) {
      clearInterval(this.auto_play_interval);
    }
  }

  nextSlide(): void {
    const slideCount = this.slides().length;
    if (slideCount <= 0) return;
    this.current_slide_index.set(
      (this.current_slide_index() + 1) % slideCount,
    );
  }

  setSlide(index: number): void {
    this.current_slide_index.set(index);
    this.stopAutoPlay();
    if (this.slides().length > 1) {
      this.startAutoPlay();
    }
  }

  get banner_config(): HeroBannerConfig {
    const tenantConfig = this.domain_service.getCurrentTenantConfig();
    const current_slide = this.currentSlide();
    const bannerVal = this.banner();

    return {
      title:
        current_slide?.title ||
        bannerVal.title ||
        'Bienvenido a nuestra tienda',
      subtitle:
        current_slide?.caption ||
        bannerVal.subtitle ||
        'Encuentra los mejores productos al mejor precio',
      image_url: current_slide?.url || bannerVal.image_url || undefined,
      background_color:
        bannerVal.background_color ||
        tenantConfig?.branding?.colors?.primary ||
        'var(--color-primary)',
      text_color: bannerVal.text_color || '#ffffff',
      cta_text: current_slide?.action_label || bannerVal.cta_text || 'Ver productos',
      cta_link: bannerVal.cta_link || '/catalog',
      show_overlay: bannerVal.show_overlay ?? true,
    };
  }

  hasSlideAction(): boolean {
    return this.resolveSlideAction(this.currentSlide()) !== null;
  }

  onBannerClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) return;

    this.runSlideAction(this.currentSlide());
  }

  onCtaClick(event: Event): void {
    event.stopPropagation();
    if (this.runSlideAction(this.currentSlide())) return;

    this.router.navigateByUrl(this.banner_config.cta_link);
  }

  onBannerKeydown(event: Event): void {
    event.preventDefault();
    this.runSlideAction(this.currentSlide());
  }

  private currentSlide(): SliderPhoto | undefined {
    return this.slides()[this.current_slide_index()];
  }

  private runSlideAction(slide?: SliderPhoto): boolean {
    const action = this.resolveSlideAction(slide);
    if (!action) return false;

    if (action.external) {
      window.open(action.url, action.target, 'noopener,noreferrer');
      return true;
    }

    this.router.navigateByUrl(action.url);
    return true;
  }

  private resolveSlideAction(
    slide?: SliderPhoto,
  ): { url: string; external: boolean; target: '_self' | '_blank' } | null {
    if (!slide || !slide.action_type || slide.action_type === 'none') {
      return null;
    }

    if (slide.action_type === 'product' && slide.product_id) {
      return { url: `/products/${slide.product_id}`, external: false, target: '_self' };
    }

    if (slide.action_type === 'category' && slide.category_id) {
      return { url: `/catalog?category=${slide.category_id}`, external: false, target: '_self' };
    }

    if (slide.action_type === 'brand' && slide.brand_id) {
      return { url: `/catalog?brand=${slide.brand_id}`, external: false, target: '_self' };
    }

    const actionUrl = slide.action_url?.trim();
    if (!actionUrl) return null;

    if (slide.action_type === 'external_url') {
      return {
        url: actionUrl,
        external: true,
        target: slide.open_in_new_tab === false ? '_self' : '_blank',
      };
    }

    if (slide.action_type === 'internal_url') {
      const internalUrl = actionUrl.startsWith('/') ? actionUrl : `/${actionUrl}`;
      return { url: internalUrl, external: false, target: '_self' };
    }

    return null;
  }
}
