---
description: Standard for handling Country, Department, and City data in Frontend (API Colombia)
---

# Vendix Frontend Country API Skill

This skill documents how to use the `CountryService` to handle location data, specifically focusing on the integration with **API Colombia** for fetching departments and cities when the selected country is Colombia ('CO').

## Context

The application uses a hybrid approach for location data:
- **Countries**: Static list in the service (e.g., Colombia, Mexico, USA).
- **Timezones**: Static list mapped to countries.
- **Departments & Cities**: Dynamic fetching via `https://api-colombia.com` **ONLY** when the country is Colombia ('CO').

## 📍 Service Location

```typescript
import { CountryService } from 'apps/frontend/src/app/services/country.service';
// Note: Verify the relative path based on your component location.
// Common alias or path: 'src/app/services/country.service'
```

**Interface Definitions:**

```typescript
export interface Country {
  code: string;
  name: string;
}

export interface Department {
  id: number;
  name: string;
}

export interface City {
  id: number;
  name: string;
  departmentId: number;
}
```

## 🛠️ Implementation Pattern

When implementing a form with location fields (Country -> Department -> City), follow this pattern:

### 1. Component Setup

Inject `CountryService` and `ChangeDetectorRef`. Define arrays for data.

```typescript
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { CountryService, Country, Department, City } from 'src/app/services/country.service';

@Component({ ... })
export class LocationFormComponent implements OnInit {
  formGroup: FormGroup;
  countries: Country[] = [];
  departments: Department[] = [];
  cities: City[] = [];

  constructor(
    private fb: FormBuilder,
    private countryService: CountryService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // 1. Load static countries
    this.countries = this.countryService.getCountries();
    
    // 2. Initialize form
    this.initForm();
    
    // 3. Setup listeners
    this.setupLocationListeners();
  }
}
```

### 2. Reactive Listeners (Cascading Dropdowns)

Handle the logic to load/clear data when parent selections change.

```typescript
setupLocationListeners() {
  const countryControl = this.formGroup.get('country_code');
  const depControl = this.formGroup.get('state_province');
  const cityControl = this.formGroup.get('city');

  // Listener: Country Change
  countryControl.valueChanges.subscribe((code: string) => {
    if (code === 'CO') {
      this.loadDepartments();
    } else {
      // Clear downstream data for non-Colombia countries
      this.departments = [];
      this.cities = [];
      depControl.setValue(null);
      cityControl.setValue(null);
      this.cdr.markForCheck(); // Important for OnPush strategy
    }
  });

  // Listener: Department Change
  depControl.valueChanges.subscribe((depId: any) => {
    if (depId) {
      const numericDepId = Number(depId);
      this.loadCities(numericDepId);
    } else {
      this.cities = [];
      cityControl.setValue(null);
      this.cdr.markForCheck();
    }
  });
}
```

### 3. Data Loading Methods

Implement `async` methods to fetch data from the service.

```typescript
async loadDepartments(): Promise<void> {
  this.departments = await this.countryService.getDepartments();
  this.cdr.markForCheck();
}

async loadCities(depId: number): Promise<void> {
  this.cities = await this.countryService.getCitiesByDepartment(depId);
  this.cdr.markForCheck();
}
```

### 4. Initialization (Edit Mode)

If loading an existing record, ensure you trigger the loads sequentially.

```typescript
private async initializeFormData(countryValue: string, depValue?: number, cityValue?: number) {
  if (countryValue === 'CO') {
    await this.loadDepartments();
    
    if (depValue) {
      this.formGroup.get('state_province')?.setValue(depValue, { emitEvent: false });
      await this.loadCities(depValue);
      
      if (cityValue) {
        this.formGroup.get('city')?.setValue(cityValue, { emitEvent: false });
      }
    }
    this.cdr.markForCheck();
  }
}
```

## ⚠️ Important Considerations

1.  **API Reliance**: The service relies on `api-colombia.com`. Ensure error handling is in place (the service methods return empty arrays on error, but UI should handle it gracefully).
2.  **Colombia Specific**: Currently, dynamic loading of departments and cities is **only** implemented for Colombia. Other countries do not auto-populate these fields.
3.  **Type Casting**: Department and City IDs from the API are numbers, but form values might be strings depending on how `<select>` binds them. Always cast to `Number()` when calling `loadCities`.
4.  **Change Detection**: Since these are async operations, always use `cdr.markForCheck()` after data arrives if using `ChangeDetectionStrategy.OnPush`.

## 📋 HTML Template Example

```html
<!-- Country -->
<select formControlName="country_code">
  <option value="">Select Country</option>
  <option *ngFor="let c of countries" [value]="c.code">{{ c.name }}</option>
</select>

<!-- Department (Only shows if populated) -->
<select formControlName="state_province">
  <option value="">Select Department</option>
  <option *ngFor="let d of departments" [value]="d.id">{{ d.name }}</option>
</select>

<!-- City -->
<select formControlName="city">
  <option value="">Select City</option>
  <option *ngFor="let c of cities" [value]="c.id">{{ c.name }}</option>
</select>
```
