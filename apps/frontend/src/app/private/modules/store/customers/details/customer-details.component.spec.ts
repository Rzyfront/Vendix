import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { CustomerDetailsComponent } from './customer-details.component';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { CustomersService } from '../services/customers.service';
import { MetadataFieldsService } from '../../data-collection/services/metadata-fields.service';
import { CustomerHistoryService } from '../services/customer-history.service';

/**
 * H0.6 — the customer profile only shows sections of the store's active
 * industries: gym deep-link only with `gym`, the Hotelería placeholder only
 * with `hospitality`, consultation history only with `service`.
 */
describe('CustomerDetailsComponent industry sections (H0.6)', () => {
  const industries = signal<string[]>([]);

  function create(storeIndustries: string[], id: string | null = '7') {
    industries.set(storeIndustries);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          // No id → the constructor triggers no data loads.
          useValue: {
            paramMap: of(convertToParamMap({})),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: CustomersService, useValue: {} },
        { provide: MetadataFieldsService, useValue: {} },
        { provide: CustomerHistoryService, useValue: {} },
        {
          provide: AuthFacade,
          useValue: {
            storeIndustries: industries,
            isGym: computed(() => industries().includes('gym')),
            isHospitality: computed(() => industries().includes('hospitality')),
          },
        },
      ],
    });
    const component = TestBed.runInInjectionContext(
      () => new CustomerDetailsComponent(),
    );
    if (id) component.customerId.set(Number(id));
    return component;
  }

  it('hides the gym member-profile action when the store has no gym industry', () => {
    const component = create(['retail', 'hospitality']);
    expect(component.gymProfileActions()).toEqual([]);
  });

  it('shows the gym member-profile action when the store has the gym industry', () => {
    const component = create(['gym', 'retail']);
    expect(component.gymProfileActions().map((a) => a.id)).toEqual(['gym-profile']);
  });

  it('shows the Hotelería placeholder only with the hospitality industry', () => {
    expect(create(['hospitality']).showHospitalitySection()).toBeTrue();
    TestBed.resetTestingModule();
    expect(create(['gym', 'service']).showHospitalitySection()).toBeFalse();
  });

  it('shows consultation history only with the service industry', () => {
    expect(create(['service']).showConsultationHistory()).toBeTrue();
    TestBed.resetTestingModule();
    expect(create(['hospitality']).showConsultationHistory()).toBeFalse();
  });

  it('shows no industry section while industries are not loaded', () => {
    const component = create([]);
    expect(component.gymProfileActions()).toEqual([]);
    expect(component.showHospitalitySection()).toBeFalse();
    expect(component.showConsultationHistory()).toBeFalse();
  });
});
