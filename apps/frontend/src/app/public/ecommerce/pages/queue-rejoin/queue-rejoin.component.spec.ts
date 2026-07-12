import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { QueueRejoinComponent } from './queue-rejoin.component';
import { TenantFacade } from '../../../../core/store';
import { environment } from '../../../../../environments/environment';
import { ButtonComponent, InputComponent, SelectorComponent, IconComponent } from '../../../../shared/components';
import { RouterTestingModule } from '@angular/router/testing';

describe('QueueRejoinComponent', () => {
  let fixture: ComponentFixture<QueueRejoinComponent>;
  let component: QueueRejoinComponent;
  let httpMock: HttpTestingController;
  let tenantFacade: TenantFacade;

  const mockTenantFacade = {
    getCurrentStoreId: jasmine.createSpy('getCurrentStoreId').and.returnValue(1),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        QueueRejoinComponent,
        HttpClientTestingModule,
        ReactiveFormsModule,
        ButtonComponent,
        InputComponent,
        SelectorComponent,
        IconComponent,
        RouterTestingModule,
      ],
      providers: [
        {
          provide: TenantFacade,
          useValue: mockTenantFacade,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QueueRejoinComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    tenantFacade = TestBed.inject(TenantFacade);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('Form Validation', () => {
    it('should require document_type field', () => {
      const control = component.form.get('document_type');

      control?.setValue(null);
      expect(control?.hasError('required')).toBe(true);

      control?.setValue('CC');
      expect(control?.hasError('required')).toBe(false);
    });

    it('should require document_number field', () => {
      const control = component.form.get('document_number');

      control?.setValue('');
      expect(control?.hasError('required')).toBe(true);

      control?.setValue('12345');
      expect(control?.hasError('required')).toBe(false);
    });

    it('should enforce minimum length of 5 characters on document_number', () => {
      const control = component.form.get('document_number');

      control?.setValue('1234');
      expect(control?.hasError('minlength')).toBe(true);

      control?.setValue('12345');
      expect(control?.hasError('minlength')).toBe(false);
    });

    it('should mark form as invalid when required fields are empty', () => {
      component.form.reset();
      expect(component.form.valid).toBe(false);
    });

    it('should mark form as valid with correct inputs', () => {
      component.form.patchValue({
        document_type: 'CC',
        document_number: '12345678',
      });
      expect(component.form.valid).toBe(true);
    });
  });

  describe('Search Success', () => {
    it('should display found entry with position when search succeeds', (done) => {
      const searchDto = {
        document_type: 'CC',
        document_number: '12345678',
      };

      component.form.patchValue(searchDto);
      component.onSearch();

      const req = httpMock.expectOne(
        `${environment.apiUrl}/ecommerce/customer-queue/search`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(searchDto);

      const mockResponseData = {
        position: 3,
        status: 'waiting',
        first_name: 'Juan',
      };

      const mockResponse = {
        success: true,
        data: mockResponseData,
      };

      req.flush(mockResponse);

      setTimeout(() => {
        expect(component.searchStatus()).toBe('found');
        expect(component.foundEntry()).toEqual(mockResponseData);
        expect(component.errorMessage()).toBe('');
        done();
      }, 10);
    });

    it('should display selected status when entry status is selected', (done) => {
      const searchDto = {
        document_type: 'CC',
        document_number: '12345678',
      };

      component.form.patchValue(searchDto);
      component.onSearch();

      const req = httpMock.expectOne(
        `${environment.apiUrl}/ecommerce/customer-queue/search`
      );

      const mockResponse = {
        success: true,
        data: {
          found: true,
          position: 1,
          status: 'selected',
          first_name: 'Maria',
        },
      };

      req.flush(mockResponse);

      setTimeout(() => {
        expect(component.searchStatus()).toBe('found');
        expect(component.foundEntry()?.status).toBe('selected');
        done();
      }, 10);
    });
  });

  describe('Search Not Found', () => {
    it('should display not found message when entry does not exist', (done) => {
      const searchDto = {
        document_type: 'CC',
        document_number: '99999999',
      };

      component.form.patchValue(searchDto);
      component.onSearch();

      const req = httpMock.expectOne(
        `${environment.apiUrl}/ecommerce/customer-queue/search`
      );

      const mockResponse = {
        success: true,
        data: null,
      };

      req.flush(mockResponse);

      setTimeout(() => {
        expect(component.searchStatus()).toBe('not_found');
        expect(component.foundEntry()).toBeNull();
        done();
      }, 10);
    });

    it('should display expired status when entry is expired', (done) => {
      const searchDto = {
        document_type: 'CC',
        document_number: '11111111',
      };

      component.form.patchValue(searchDto);
      component.onSearch();

      const req = httpMock.expectOne(
        `${environment.apiUrl}/ecommerce/customer-queue/search`
      );

      const mockErrorResponse = {
        message: 'ENTRY_EXPIRED',
      };

      req.flush(mockErrorResponse, { status: 400, statusText: 'Bad Request' });

      setTimeout(() => {
        expect(component.searchStatus()).toBe('expired');
        done();
      }, 10);
    });

    it('should display error message on generic server error', (done) => {
      const searchDto = {
        document_type: 'CC',
        document_number: '12345678',
      };

      component.form.patchValue(searchDto);
      component.onSearch();

      const req = httpMock.expectOne(
        `${environment.apiUrl}/ecommerce/customer-queue/search`
      );

      req.flush(
        { message: 'INTERNAL_SERVER_ERROR' },
        { status: 500, statusText: 'Server Error' }
      );

      setTimeout(() => {
        expect(component.searchStatus()).toBe('idle');
        expect(component.errorMessage()).toContain('Error al buscar entrada');
        done();
      }, 10);
    });
  });

  describe('Reset and Navigation', () => {
    it('should reset form and state when onReset is called', () => {
      component.foundEntry.set({
        position: 5,
        status: 'waiting',
        first_name: 'Test',
      });
      component.searchStatus.set('found');
      component.errorMessage.set('Some error');

      component.onReset();

      expect(component.searchStatus()).toBe('idle');
      expect(component.foundEntry()).toBeNull();
      expect(component.errorMessage()).toBe('');
      expect(component.form.get('document_type')?.value).toBe('CC');
      expect(component.form.get('document_number')?.value).toBeNull();
    });

    it('should set loading state while search is in progress', (done) => {
      const searchDto = {
        document_type: 'CC',
        document_number: '12345678',
      };

      component.form.patchValue(searchDto);
      component.onSearch();

      expect(component.searchStatus()).toBe('loading');

      const req = httpMock.expectOne(
        `${environment.apiUrl}/ecommerce/customer-queue/search`
      );

      const mockResponse = {
        success: true,
        data: {
          found: true,
          position: 3,
          status: 'waiting',
          first_name: 'Juan',
        },
      };

      req.flush(mockResponse);

      setTimeout(() => {
        expect(component.searchStatus()).not.toBe('loading');
        done();
      }, 10);
    });
  });

  describe('HTTP Headers', () => {
    it('should include x-store-id header in search request', () => {
      const searchDto = {
        document_type: 'CC',
        document_number: '12345678',
      };

      component.form.patchValue(searchDto);
      component.onSearch();

      const req = httpMock.expectOne(
        `${environment.apiUrl}/ecommerce/customer-queue/search`
      );

      expect(req.request.headers.has('x-store-id')).toBe(true);
      expect(req.request.headers.get('x-store-id')).toBe('1');

      req.flush({
        success: true,
        data: null,
      });
    });

    it('should call getCurrentStoreId from tenant facade', () => {
      const searchDto = {
        document_type: 'CC',
        document_number: '12345678',
      };

      component.form.patchValue(searchDto);
      component.onSearch();

      const req = httpMock.expectOne(
        `${environment.apiUrl}/ecommerce/customer-queue/search`
      );

      expect(mockTenantFacade.getCurrentStoreId).toHaveBeenCalled();

      req.flush({
        success: true,
        data: { found: false },
      });
    });
  });
});
