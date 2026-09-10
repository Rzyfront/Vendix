import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { RutScannerModalComponent } from './rut-scanner-modal.component';
import { RutScannerService } from '../services/rut-scanner.service';
import { ToastService } from '../../toast/toast.service';
import { RutScanResult } from '../interfaces/rut-scan-result.interface';

describe('RutScannerModalComponent (Step C.2)', () => {
  let fixture: ComponentFixture<RutScannerModalComponent>;
  let component: RutScannerModalComponent;

  const toastServiceStub = {
    error: jasmine.createSpy('error'),
    success: jasmine.createSpy('success'),
  };

  const rutScannerServiceStub = {
    scanRutFile: jasmine.createSpy('scanRutFile'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RutScannerModalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: toastServiceStub },
        { provide: RutScannerService, useValue: rutScannerServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RutScannerModalComponent);
    component = fixture.componentInstance;
  });

  describe('getResponsibilityBadgeText', () => {
    it('should translate raw numeric and O-prefixed codes to readable labels', () => {
      expect(component.getResponsibilityBadgeText('05')).toBe(
        '05 - Impuesto sobre la renta - Régimen ordinario',
      );
      expect(component.getResponsibilityBadgeText('14')).toBe(
        '14 - Informante de exógena',
      );
      expect(component.getResponsibilityBadgeText('48')).toBe(
        '48 - Responsable de IVA',
      );
      expect(component.getResponsibilityBadgeText('52')).toBe(
        '52 - Facturador electrónico',
      );
      expect(component.getResponsibilityBadgeText('O-48')).toBe(
        'O-48 - Responsable de IVA',
      );
    });
  });

  describe('review step badges', () => {
    it('paints badges for 05, 14, 48, 52 without errors', () => {
      const mockResult: RutScanResult = {
        nit: '900123456',
        nit_dv: '1',
        nit_type: 'NIT',
        legal_name: 'Empresa Test SAS',
        person_type: 'JURIDICA',
        tax_regime: 'COMUN',
        ciiu: '4711',
        fiscal_address: 'Calle 100 # 10-20',
        country: 'Colombia',
        department: 'Bogotá D.C.',
        city: 'Bogotá',
        tax_responsibilities: ['05', '14', '48', '52'],
        tax_scheme: '48',
        confidence: 0.95,
      };

      fixture.componentRef.setInput('isOpen', true);
      component.currentStep.set(3);
      component.result.set(mockResult);
      fixture.detectChanges();

      const element: HTMLElement = fixture.nativeElement;
      const text = element.textContent ?? '';
      expect(text).toContain('05 - Impuesto sobre la renta - Régimen ordinario');
      expect(text).toContain('14 - Informante de exógena');
      expect(text).toContain('48 - Responsable de IVA');
      expect(text).toContain('52 - Facturador electrónico');
    });
  });

  describe('onConfirm normalization', () => {
    it('normalizes tax_responsibilities and tax_scheme before emitting confirmed', () => {
      const mockResult: RutScanResult = {
        nit: '900123456',
        nit_dv: '1',
        nit_type: 'NIT',
        legal_name: 'Empresa Test SAS',
        person_type: 'JURIDICA',
        tax_regime: 'COMUN',
        ciiu: '4711',
        fiscal_address: 'Calle 100 # 10-20',
        country: 'Colombia',
        department: 'Bogotá D.C.',
        city: 'Bogotá',
        tax_responsibilities: ['05', '14', '48', '52', 'R-99-PJ'],
        tax_scheme: '48',
        confidence: 0.95,
      };

      component.result.set(mockResult);
      component.aiAck.set(true);

      let emittedResult: RutScanResult | null = null;
      component.confirmed.subscribe((res) => {
        emittedResult = res;
      });

      component.onConfirm();

      expect(emittedResult).not.toBeNull();
      expect(emittedResult!.tax_responsibilities).toEqual([
        'O-05',
        'O-14',
        'O-48',
        'O-52',
        'R-99-PN', // R-99-PJ rewritten to R-99-PN per ADR-04
      ]);
      expect(emittedResult!.tax_scheme).toBe('O-48');
    });
  });
});
