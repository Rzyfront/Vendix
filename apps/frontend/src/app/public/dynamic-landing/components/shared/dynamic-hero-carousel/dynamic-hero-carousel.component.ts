import { Component, OnInit, OnDestroy, input, computed } from '@angular/core';

import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-dynamic-hero-carousel',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './dynamic-hero-carousel.component.html',
  styleUrls: ['./dynamic-hero-carousel.component.scss'],
})
export class DynamicHeroCarouselComponent implements OnInit, OnDestroy {
  readonly slides = input<any[]>([]);
  readonly effectiveSlides = computed(() => {
    const s = this.slides();
    return s && s.length > 0 ? s : this.defaultSlides;
  });

  // Default slides configuration if none provided (optional fallback)
  defaultSlides = [
    {
      image: 'assets/images/placeholder-hero.jpg', // Ensure this exists or use a generic one
      message: 'Welcome',
      subtitle: 'Experience the future of commerce.',
      buttonText: 'Get Started',
      buttonLink: '/auth/register',
      secondaryButtonText: 'Learn More',
    },
  ];

  config = {
    spaceBetween: 0,
    slidesPerView: 1,
    pagination: {
      clickable: true,
      dynamicBullets: true,
      dynamicMainBullets: 3,
    },
    loop: true,
    autoplay: {
      delay: 5000,
      disableOnInteraction: false,
    },
    effect: 'fade',
    fadeEffect: {
      crossFade: true,
    },
    speed: 1000,
    allowTouchMove: true,
    grabCursor: true,
  };

  currentSlideIndex = 0;
  private autoplayInterval: any;

  constructor() {}

  ngOnInit() {
    if (!this.slides || this.slides.length === 0) {
      // If no slides provided, we could use defaults or just show nothing/placeholder
      // For now, let's just initialize if we have slides
      // this.slides = this.defaultSlides;
    }

    if (this.slides.length > 0) {
      this.startAutoplay();
    }
  }

  nextSlide() {
    if (!this.slides.length) return;
    this.currentSlideIndex = (this.currentSlideIndex + 1) % this.slides.length;
  }

  previousSlide() {
    if (!this.slides.length) return;
    this.currentSlideIndex =
      (this.currentSlideIndex - 1 + this.slides.length) % this.slides.length;
  }

  goToSlide(index: number) {
    this.currentSlideIndex = index;
    this.resetAutoplay();
  }

  private startAutoplay() {
    this.autoplayInterval = setInterval(() => {
      this.nextSlide();
    }, 5000);
  }

  private resetAutoplay() {
    if (this.autoplayInterval) {
      clearInterval(this.autoplayInterval);
      this.startAutoplay();
    }
  }

  ngOnDestroy() {
    if (this.autoplayInterval) {
      clearInterval(this.autoplayInterval);
    }
  }
}
