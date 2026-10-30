import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { VendixLandingComponent } from './vendix-landing.component';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';
import { PublicPlansService } from '../../pricing/services/public-plans.service';

/**
 * SEO-TECH-09: «Planes y Precios» del menú es un enlace real a /pricing
 * (rastreable, abrible en otra pestaña y enfocable con Tab), no un botón de scroll.
 */
describe('VendixLandingComponent menu links (SEO-TECH-09)', () => {
  let fixture: ComponentFixture<VendixLandingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VendixLandingComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: TenantFacade, useValue: { tenantConfig$: of(null) } },
        { provide: PublicPlansService, useValue: { list$: of({ success: true, data: [] }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VendixLandingComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  function pricingLinks(): HTMLAnchorElement[] {
    return fixture.debugElement
      .queryAll(By.css('header a'))
      .map((el) => el.nativeElement as HTMLAnchorElement)
      .filter((a) => a.textContent?.trim() === 'Planes y Precios');
  }

  function pricingButtons(): HTMLButtonElement[] {
    return fixture.debugElement
      .queryAll(By.css('header button'))
      .map((el) => el.nativeElement as HTMLButtonElement)
      .filter((b) => b.textContent?.trim() === 'Planes y Precios');
  }

  it('renders the desktop "Planes y Precios" item as a link to /pricing', () => {
    const links = pricingLinks();
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('/pricing');
    expect(links[0].tabIndex).toBe(0);
    expect(pricingButtons().length).toBe(0);
  });

  it('renders the mobile "Planes y Precios" item as a link that closes the menu', async () => {
    fixture.componentInstance.toggleMobileMenu();
    fixture.detectChanges();
    await fixture.whenStable();

    const links = pricingLinks();
    expect(links.length).toBe(2);
    expect(links.every((a) => a.getAttribute('href') === '/pricing')).toBeTrue();
    expect(pricingButtons().length).toBe(0);

    links[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(fixture.componentInstance.mobileMenuOpen()).toBeFalse();
  });
});
