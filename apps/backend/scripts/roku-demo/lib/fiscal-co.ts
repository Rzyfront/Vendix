/**
 * Colombian fiscal constants used by the Roku demo seed.
 *
 * Hardcoded reference values are NOT legal advice. They reflect common
 * 2025/2026 rates used to make the demo dataset feel realistic. Real
 * production numbers should always come from the seeded
 * `withholding-tax`, `ica-municipal-rates`, and `fiscal-rule-sets` modules.
 */

// Colombian withholding tax rates (2026 reference values, illustrative)
export const WITHHOLDING_RATES = {
  RETEFUENTE_SERVICIOS: 0.04,        // 4% sobre servicios
  RETEFUENTE_COMPRAS: 0.025,         // 2.5% sobre compras generales
  RETEFUENTE_HONORARIOS: 0.10,       // 10% sobre honorarios
  RETEFUENTE_ARRENDAMIENTOS: 0.035,  // 3.5% sobre arrendamientos
  RETEIVA: 0.15,                     // 15% del IVA (servicios gravados)
  RETEICA_BOGOTA_INDUSTRIAL: 0.00966, // 9.66 por mil (industrial Bogotá)
  RETEICA_BOGOTA_COMERCIAL: 0.00652,  // 6.52 por mil (comercial Bogotá)
  RETEICA_BOGOTA_SERVICIOS: 0.00966,  // 9.66 por mil (servicios Bogotá)
} as const;

// Common Colombian IVA rates
export const IVA_RATES = {
  GENERAL: 0.19,     // 19% general
  REDUCIDO: 0.05,    // 5% reducido (alimentos, etc.)
  EXENTO: 0.00,      // 0% exento
} as const;

// Common INC rates (Impuesto Nacional al Consumo)
export const INC_RATES = {
  GENERAL: 0.08,     // 8% general
  RESTAURANT: 0.08,  // 8% restaurantes
} as const;

// Common ICA rates per mil (Bogotá)
export const ICA_RATES_PER_MIL = {
  BOGOTA_INDUSTRIAL: 11.04,
  BOGOTA_COMERCIAL: 11.04,
  BOGOTA_SERVICIOS: 11.04,
  MEDELLIN_INDUSTRIAL: 7.0,
  CALI_INDUSTRIAL: 8.0,
} as const;

// UVT 2026 (Resolución DIAN). 1 UVT = $52.374 COP en 2026
export const UVT_2026 = 52374;

// Salary minimum reference (2026 ~ $1.750.905 COP)
export const SALARY_MINIMUM_2026 = 1750905;

// Transportation allowance (2026 ~ $200.000 COP)
export const TRANSPORT_ALLOWANCE_2026 = 200000;

// Payroll constants
export const PAYROLL_HEALTH_PCT = 0.04;        // 4% salud empleado
export const PAYROLL_PENSION_PCT = 0.04;       // 4% pensión empleado
export const PAYROLL_FONDO_SOLIDARIDAD_PCT = 0.01; // 1% fondo solidaridad (>4 SMLMV)
export const EMPLOYER_HEALTH_PCT = 0.085;      // 8.5% salud empleador
export const EMPLOYER_PENSION_PCT = 0.12;      // 12% pensión empleador
export const EMPLOYER_ARL_PCT_MIN = 0.00522;   // 0.522% ARL riesgo I
export const EMPLOYER_CAJA_PCT = 0.04;         // 4% caja compensación
export const EMPLOYER_ICBF_PCT = 0.03;         // 3% ICBF (empleadores que pagan salud completa)
export const EMPLOYER_SENA_PCT = 0.02;         // 2% SENA

// Severance / social benefits
export const SEVERANCE_PCT = 0.0833;   // 1 mes / 12 = 8.33% anual
export const SEVERANCE_INTEREST_PCT = 0.12; // 12% sobre cesantías
export const PRIMA_PCT = 0.0833;       // 1 mes / 12 = 8.33% anual (prima de servicios)
export const VACATION_PCT = 0.0417;    // 15 días hábiles / 360 ≈ 4.17% anual

// Retención en la fuente tabla 2026 (simplificada para demo)
export const RETEFUENTE_TABLE_2026 = [
  { from: 0,      to: 95,        rate: 0,      base: 'UVT' },
  { from: 95,     to: 150,       rate: 0.19,   base: 'UVT' },
  { from: 150,    to: 360,       rate: 0.28,   base: 'UVT' },
  { from: 360,    to: 640,       rate: 0.33,   base: 'UVT' },
  { from: 640,    to: 945,       rate: 0.35,   base: 'UVT' },
  { from: 945,    to: 2300,      rate: 0.37,   base: 'UVT' },
  { from: 2300,   to: Infinity,  rate: 0.39,   base: 'UVT' },
] as const;

// Currency
export const CURRENCY = 'COP';
export const COUNTRY_CODE = 'CO';

// Default Bogotá coordinates (for the store / addresses)
export const BOGOTA = {
  country_code: 'CO',
  state_province: 'Bogotá D.C.',
  city: 'Bogotá',
  municipality_code: '11001',
  department_code: '11',
  postal_code: '110111',
  timezone: 'America/Bogota',
  phone_prefix: '+57',
  lat: 4.7110,
  lng: -74.0721,
} as const;
