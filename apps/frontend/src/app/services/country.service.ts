import { Injectable } from '@angular/core';

export interface Country {
  code: string;
  name: string;
}

export interface Timezone {
  value: string;
  label: string;
  countryCode: string;
}

@Injectable({
  providedIn: 'root',
})
export class CountryService {
  private countries: Country[] = [
    { code: 'CO', name: 'Colombia' },
    { code: 'MX', name: 'México' },
    { code: 'US', name: 'Estados Unidos' },
    { code: 'AR', name: 'Argentina' },
    { code: 'CL', name: 'Chile' },
    { code: 'PE', name: 'Perú' },
    { code: 'ES', name: 'España' },
  ];

  private timezones: Timezone[] = [
    { value: 'America/Bogota', label: 'Bogotá (UTC-5)', countryCode: 'CO' },
    {
      value: 'America/Mexico_City',
      label: 'Ciudad de México (UTC-6)',
      countryCode: 'MX',
    },
    {
      value: 'America/New_York',
      label: 'Nueva York (UTC-5)',
      countryCode: 'US',
    },
    {
      value: 'America/Los_Angeles',
      label: 'Los Ángeles (UTC-8)',
      countryCode: 'US',
    },
    {
      value: 'America/Argentina/Buenos_Aires',
      label: 'Buenos Aires (UTC-3)',
      countryCode: 'AR',
    },
    { value: 'America/Santiago', label: 'Santiago (UTC-4)', countryCode: 'CL' },
    { value: 'America/Lima', label: 'Lima (UTC-5)', countryCode: 'PE' },
    { value: 'Europe/Madrid', label: 'Madrid (UTC+1)', countryCode: 'ES' },
  ];

  getCountries(): Country[] {
    return this.countries;
  }

  getTimezones(countryCode?: string): Timezone[] {
    if (countryCode) {
      return this.timezones.filter((tz) => tz.countryCode === countryCode);
    }
    return this.timezones;
  }

  getDefaultCountry(): string {
    return 'CO';
  }

  getDefaultTimezone(countryCode?: string): string {
    if (countryCode === 'CO') {
      return 'America/Bogota';
    }
    return 'America/Bogota';
  }

  getCountryName(code: string): string {
    const country = this.countries.find((c) => c.code === code);
    return country ? country.name : code;
  }

  getTimezoneLabel(value: string): string {
    const timezone = this.timezones.find((tz) => tz.value === value);
    return timezone ? timezone.label : value;
  }
}
