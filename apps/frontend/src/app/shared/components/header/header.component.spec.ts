/**
 * Snapshot test for the HeaderComponent's breadcrumb data.
 *
 * Captures the breadcrumb chain shape introduced by ISSUE-08:
 *   - `parents?: BreadcrumbItem[]` (full chain, outermost first)
 *   - `parent?: BreadcrumbItem` (last element of parents, backward compat)
 *   - `current: BreadcrumbItem`
 *
 * Per the ISSUE-08 scope decision: only `<title>` is upgraded to 3 levels;
 * the visual breadcrumb in the header stays at 2 levels (parent + current).
 * This test pins down the data shape so future header changes don't silently
 * break the 3-level chain that the title effect depends on.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HeaderComponent } from './header.component';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';

describe('HeaderComponent — breadcrumb snapshot (ISSUE-08)', () => {
  let fixture: ComponentFixture<HeaderComponent>;
  let breadcrumbSignal: ReturnType<typeof signal>;

  beforeEach(async () => {
    // The chain for /admin/analytics/sales/by-product after ISSUE-08 fix:
    breadcrumbSignal = signal({
      parents: [
        {
          label: 'Analíticas',
          url: '/admin/analytics',
          icon: 'chart-line',
        },
        { label: 'Ventas', url: '/admin/analytics/sales', icon: 'dollar-sign' },
      ],
      parent: { label: 'Ventas', url: '/admin/analytics/sales', icon: 'dollar-sign' },
      current: {
        label: 'Por Producto',
        url: '/admin/analytics/sales/by-product',
        icon: 'package',
      },
      title: 'Por Producto',
    });

    const breadcrumbServiceStub = {
      breadcrumb: breadcrumbSignal,
      breadcrumb$: {
        subscribe: () => ({ closed: false, unsubscribe: () => {} }),
      },
      addRoute: () => {},
      removeRoute: () => {},
      navigateToParent: () => {},
      updateCurrentTitle: () => {},
      getCurrentTitle: () => 'Por Producto',
    };

    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        provideRouter([]),
        { provide: BreadcrumbService, useValue: breadcrumbServiceStub },
        // Facades stubbed minimally so `inject()` doesn't throw. If the
        // template dereferences more methods, extend these stubs.
        // GlobalFacade / ConfigFacade / AuthFacade are not consumed by the
        // breadcrumb render path itself — extending these stubs only matters
        // for sibling UI like the user dropdown, which is out of scope.
      ],
    })
      .overrideComponent(HeaderComponent, {
        set: {
          providers: [
            // Empty provider list: signals used in the template fall back to
            // undefined and `@if` guards skip them.
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
  });

  it('exposes the parent/current chain on the breadcrumb signal', () => {
    const data = fixture.componentInstance.breadcrumb();
    expect(data?.parent?.label).toBe('Ventas');
    expect(data?.current.label).toBe('Por Producto');
    expect(data?.title).toBe('Por Producto');
  });

  it('locks down the breadcrumb data shape (ISSUE-08 regression baseline)', () => {
    // Pins down the exact shape so future refactors that accidentally drop
    // `parent` or change its type will fail this test and force a
    // deliberate update.
    //
    // Uses explicit toEqual() because the project ships Jasmine (not Jest),
    // so toMatchSnapshot() is not available.
    const data = fixture.componentInstance.breadcrumb();
    expect(data).toEqual({
      parent: {
        label: 'Ventas',
        url: '/admin/analytics/sales',
        icon: 'dollar-sign',
      },
      current: {
        label: 'Por Producto',
        url: '/admin/analytics/sales/by-product',
        icon: 'package',
      },
      title: 'Por Producto',
    });
  });
});