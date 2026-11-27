import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ComparisonPageComponent, formatCheckedAt } from './comparison-page.component';
import { COMPARISON_ROWS } from './comparison-page.content';
import { COMPARISON_PAGE_INDEXABLE } from './comparison-page.config';

/** SEO-OPS-30: comparativa honesta, con fuente y fecha, y noindex hasta la firma. */
describe('ComparisonPageComponent (SEO-OPS-30)', () => {
  let fixture: ComponentFixture<ComparisonPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComparisonPageComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([{ path: '**', children: [] }])],
    }).compileComponents();
    fixture = TestBed.createComponent(ComparisonPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('renders one row per provider, each with an official source link', () => {
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('.comparison-table tbody tr');
    expect(rows.length).toBe(COMPARISON_ROWS.length);
    expect(COMPARISON_ROWS.every((row) => /^https:\/\//.test(row.sourceUrl))).toBeTrue();
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.comparison-table a'),
    );
    expect(links.every((a) => a.getAttribute('rel') === 'noopener nofollow')).toBeTrue();
  });

  it('discloses that Vendix publishes it and shows the date prices were checked', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Publicado por Vendix.');
    expect(text).toContain('Precios consultados el 19 de noviembre de 2026');
  });

  it('never leaves a cell empty: missing data says «no publicado»', () => {
    for (const row of COMPARISON_ROWS) {
      for (const value of [row.plan, row.price, row.invoices, row.locations, row.restaurant, row.trial]) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('stays noindex with the draft label until the legal review and sign-off', () => {
    expect(COMPARISON_PAGE_INDEXABLE).toBeFalse();
    expect((fixture.nativeElement as HTMLElement).querySelector('.preview-label')).not.toBeNull();
  });

  it('formats the checked date without depending on the timezone', () => {
    expect(formatCheckedAt('2026-11-19')).toBe('19 de noviembre de 2026');
    expect(formatCheckedAt('2027-01-05')).toBe('5 de enero de 2027');
  });
});
