import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

export interface Country {
  code: string;
  name: string;
  timezone?: string;
}

export interface Timezone {
  value: string;
  label: string;
}

@Injectable({
  providedIn: 'root',
})
export class CountryService {
  private countries: Country[] = [
    { code: 'CO', name: 'Colombia', timezone: 'America/Bogota' },
    { code: 'MX', name: 'México' },
    { code: 'AR', name: 'Argentina' },
    { code: 'BR', name: 'Brasil' },
    { code: 'CL', name: 'Chile' },
    { code: 'PE', name: 'Perú' },
    { code: 'EC', name: 'Ecuador' },
    { code: 'VE', name: 'Venezuela' },
    { code: 'US', name: 'United States' },
    { code: 'ES', name: 'España' },
    { code: 'CA', name: 'Canada' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'FR', name: 'France' },
    { code: 'DE', name: 'Germany' },
    { code: 'IT', name: 'Italy' },
    { code: 'PT', name: 'Portugal' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'BE', name: 'Belgium' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'AT', name: 'Austria' },
    { code: 'SE', name: 'Sweden' },
    { code: 'NO', name: 'Norway' },
    { code: 'DK', name: 'Denmark' },
    { code: 'FI', name: 'Finland' },
    { code: 'PL', name: 'Poland' },
    { code: 'CZ', name: 'Czech Republic' },
    { code: 'HU', name: 'Hungary' },
    { code: 'GR', name: 'Greece' },
    { code: 'TR', name: 'Turkey' },
    { code: 'IL', name: 'Israel' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'EG', name: 'Egypt' },
    { code: 'ZA', name: 'South Africa' },
    { code: 'AU', name: 'Australia' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'IN', name: 'India' },
    { code: 'SG', name: 'Singapore' },
    { code: 'MY', name: 'Malaysia' },
    { code: 'TH', name: 'Thailand' },
    { code: 'PH', name: 'Philippines' },
    { code: 'ID', name: 'Indonesia' },
    { code: 'VN', name: 'Vietnam' },
    { code: 'HK', name: 'Hong Kong' },
    { code: 'TW', name: 'Taiwan' },
    { code: 'KR', name: 'South Korea' },
    { code: 'JP', name: 'Japan' },
    { code: 'CN', name: 'China' },
    { code: 'RU', name: 'Russia' },
    { code: 'UA', name: 'Ukraine' },
    { code: 'KZ', name: 'Kazakhstan' },
    { code: 'BY', name: 'Belarus' },
    { code: 'RO', name: 'Romania' },
    { code: 'BG', name: 'Bulgaria' },
    { code: 'HR', name: 'Croatia' },
    { code: 'SI', name: 'Slovenia' },
    { code: 'SK', name: 'Slovakia' },
    { code: 'EE', name: 'Estonia' },
    { code: 'LV', name: 'Latvia' },
    { code: 'LT', name: 'Lithuania' },
    { code: 'IS', name: 'Iceland' },
    { code: 'IE', name: 'Ireland' },
    { code: 'LU', name: 'Luxembourg' },
    { code: 'MT', name: 'Malta' },
    { code: 'CY', name: 'Cyprus' },
  ];

  private timezones: Timezone[] = [
    { value: 'America/Bogota', label: 'Bogotá (GMT-5)' },
    { value: 'America/Mexico_City', label: 'Ciudad de México (GMT-6)' },
    { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (GMT-3)' },
    { value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' },
    { value: 'America/Santiago', label: 'Santiago (GMT-4)' },
    { value: 'America/Lima', label: 'Lima (GMT-5)' },
    { value: 'America/Guayaquil', label: 'Guayaquil (GMT-5)' },
    { value: 'America/Caracas', label: 'Caracas (GMT-4)' },
    { value: 'America/New_York', label: 'Nueva York (GMT-5)' },
    { value: 'America/Los_Angeles', label: 'Los Ángeles (GMT-8)' },
    { value: 'America/Chicago', label: 'Chicago (GMT-6)' },
    { value: 'America/Denver', label: 'Denver (GMT-7)' },
    { value: 'America/Phoenix', label: 'Phoenix (GMT-7)' },
    { value: 'America/Toronto', label: 'Toronto (GMT-5)' },
    { value: 'America/Vancouver', label: 'Vancouver (GMT-8)' },
    { value: 'America/Halifax', label: 'Halifax (GMT-4)' },
    { value: 'America/St_Johns', label: "St. John's (GMT-3:30)" },
    { value: 'Europe/Madrid', label: 'Madrid (GMT+1)' },
    { value: 'Europe/Paris', label: 'París (GMT+1)' },
    { value: 'Europe/Berlin', label: 'Berlín (GMT+1)' },
    { value: 'Europe/Rome', label: 'Roma (GMT+1)' },
    { value: 'Europe/London', label: 'Londres (GMT+0)' },
    { value: 'Europe/Amsterdam', label: 'Ámsterdam (GMT+1)' },
    { value: 'Europe/Brussels', label: 'Bruselas (GMT+1)' },
    { value: 'Europe/Zurich', label: 'Zúrich (GMT+1)' },
    { value: 'Europe/Vienna', label: 'Viena (GMT+1)' },
    { value: 'Europe/Stockholm', label: 'Estocolmo (GMT+1)' },
    { value: 'Europe/Oslo', label: 'Oslo (GMT+1)' },
    { value: 'Europe/Copenhagen', label: 'Copenhague (GMT+1)' },
    { value: 'Europe/Helsinki', label: 'Helsinki (GMT+2)' },
    { value: 'Europe/Warsaw', label: 'Varsovia (GMT+1)' },
    { value: 'Europe/Prague', label: 'Praga (GMT+1)' },
    { value: 'Europe/Budapest', label: 'Budapest (GMT+1)' },
    { value: 'Europe/Athens', label: 'Atenas (GMT+2)' },
    { value: 'Europe/Istanbul', label: 'Estambul (GMT+3)' },
    { value: 'Asia/Tel_Aviv', label: 'Tel Aviv (GMT+2)' },
    { value: 'Asia/Dubai', label: 'Dubái (GMT+4)' },
    { value: 'Asia/Riyadh', label: 'Riad (GMT+3)' },
    { value: 'Africa/Cairo', label: 'El Cairo (GMT+2)' },
    { value: 'Africa/Johannesburg', label: 'Johannesburgo (GMT+2)' },
    { value: 'Australia/Sydney', label: 'Sydney (GMT+10)' },
    { value: 'Australia/Melbourne', label: 'Melbourne (GMT+10)' },
    { value: 'Australia/Perth', label: 'Perth (GMT+8)' },
    { value: 'Pacific/Auckland', label: 'Auckland (GMT+12)' },
    { value: 'Asia/Kolkata', label: 'Nueva Delhi (GMT+5:30)' },
    { value: 'Asia/Singapore', label: 'Singapur (GMT+8)' },
    { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (GMT+8)' },
    { value: 'Asia/Bangkok', label: 'Bangkok (GMT+7)' },
    { value: 'Asia/Manila', label: 'Manila (GMT+8)' },
    { value: 'Asia/Jakarta', label: 'Yakarta (GMT+7)' },
    { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh (GMT+7)' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (GMT+8)' },
    { value: 'Asia/Taipei', label: 'Taipéi (GMT+8)' },
    { value: 'Asia/Seoul', label: 'Seúl (GMT+9)' },
    { value: 'Asia/Tokyo', label: 'Tokio (GMT+9)' },
    { value: 'Asia/Shanghai', label: 'Shanghái (GMT+8)' },
    { value: 'Europe/Moscow', label: 'Moscú (GMT+3)' },
    { value: 'Europe/Kiev', label: 'Kiev (GMT+2)' },
    { value: 'Asia/Almaty', label: 'Almaty (GMT+6)' },
    { value: 'Europe/Minsk', label: 'Minsk (GMT+3)' },
    { value: 'Europe/Bucharest', label: 'Bucarest (GMT+2)' },
    { value: 'Europe/Sofia', label: 'Sofía (GMT+2)' },
    { value: 'Europe/Zagreb', label: 'Zagreb (GMT+1)' },
    { value: 'Europe/Bratislava', label: 'Bratislava (GMT+1)' },
    { value: 'Europe/Tallinn', label: 'Tallin (GMT+2)' },
    { value: 'Europe/Riga', label: 'Riga (GMT+2)' },
    { value: 'Europe/Vilnius', label: 'Vilna (GMT+2)' },
    { value: 'Atlantic/Reykjavik', label: 'Reykjavik (GMT+0)' },
    { value: 'Europe/Dublin', label: 'Dublín (GMT+0)' },
    { value: 'Europe/Luxembourg', label: 'Luxemburgo (GMT+1)' },
    { value: 'Europe/Malta', label: 'Malta (GMT+1)' },
    { value: 'Asia/Nicosia', label: 'Nicosia (GMT+2)' },
  ];

  getCountries(): Observable<Country[]> {
    return of(this.countries);
  }

  getTimezones(): Observable<Timezone[]> {
    return of(this.timezones);
  }

  getDefaultCountry(): Country {
    return this.countries[0]; // Colombia
  }

  getDefaultTimezone(): Timezone {
    return this.timezones[0]; // Bogotá
  }

  getCountryByCode(code: string): Country | undefined {
    return this.countries.find((country) => country.code === code);
  }

  getTimezoneByValue(value: string): Timezone | undefined {
    return this.timezones.find((timezone) => timezone.value === value);
  }
}
