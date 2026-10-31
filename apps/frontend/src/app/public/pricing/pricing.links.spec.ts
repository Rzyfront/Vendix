import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PricingComponent } from './pricing.component';
import { PublicPlansService } from './services/public-plans.service';

/**
 * SEO-TECH-09: /pricing deja de ser una página sin salida. Los enlaces son <a href>
 * reales (rastreables por Google y abribles en otra pestaña), no botones con navigate().
 */
describe('PricingComponent outbound links (SEO-TECH-09)', () => {
  let fixture: ComponentFixture<PricingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PricingComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: PublicPlansService, useValue: { list$: of({ success: true, data: [] }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PricingComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('ofrece enlaces reales a inicio, ayuda, registro, ingreso y términos', () => {
    const hrefs = fixture.debugElement
      .queryAll(By.css('nav[aria-label="Más sobre Vendix"] a'))
      .map((el) => (el.nativeElement as HTMLAnchorElement).getAttribute('href'));

    expect(hrefs).toEqual(['/', '/ayuda', '/auth/register', '/auth/login', '/legal/terminos']);
  });
});
