import { Prisma } from '@prisma/client';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  DIAN_TAX_CODES,
  DIAN_TAX_NAMES,
} from '../providers/dian-direct/constants/dian-tax-codes';
import { DIAN_UNIT_CODES } from '../providers/dian-direct/constants/dian-unit-codes';
import {
  AiuBucket,
  AiuComponentLiteral,
  InvoiceProfileConfig,
  resolveAiuComponentsBasis,
  resolveAccountingModel,
  resolveAiuTaxableBasis,
} from './invoice-profile-config.contract';
import {
  InvoiceCalculatorLineInput,
  InvoiceCalculatorResult,
  InvoiceCalculatorService,
} from '../services/invoice-calculator.service';
import { dianAmount, dianLineExtension, dianSum, toDecimal } from '../utils/dian-money.util';

export const AIU_EMISSION_ORDER: readonly AiuComponentLiteral[] = [
  'administracion',
  'imprevistos',
  'utilidad',
];
export const AIU_RESIDUE_PRIORITY: readonly AiuComponentLiteral[] = [
  'utilidad',
  'administracion',
  'imprevistos',
];
const BUCKET_DEFAULT_DESCRIPTION: Readonly<Record<AiuBucket, string>> = {
  administracion: 'Administración',
  imprevistos: 'Imprevistos',
  utilidad: 'Utilidad',
  costo: 'Costo reembolsable',
};
const TAX_TYPE_BY_DIAN_CODE: Readonly<Record<string, string>> = {
  [DIAN_TAX_CODES.IVA]: 'iva',
  [DIAN_TAX_CODES.INC]: 'inc',
  [DIAN_TAX_CODES.ICA]: 'ica',
};

export interface ProfileContractCostLine {
  description: string;
  quantity: string | number;
  unit_price: string | number;
  discount_amount?: string | number;
  unit_code?: string;
}

/** Calculator input plus the bucket/unit metadata needed to persist/render it. */
export interface ProfileContractInvoiceLine extends InvoiceCalculatorLineInput {
  bucket: AiuBucket | 'contrato';
  unit_code: string;
}

export interface ProfileContractEconomicsResult {
  invoice_lines: ProfileContractInvoiceLine[];
  calculation: InvoiceCalculatorResult;
  direct_cost: string;
  contract_value: string;
  aiu_value: string;
}

const ONE_CENT = toDecimal('0.01');

/**
 * Canonical profile-preview splitter. Keep this as the sole remainder-cent
 * implementation for both the invoice-profile preview and contract quoting.
 */
export function splitAiuByComponents(
  aiu_value: Prisma.Decimal,
  contract_value: Prisma.Decimal,
  config: InvoiceProfileConfig,
): Map<AiuComponentLiteral, Prisma.Decimal> {
  const basis = resolveAiuComponentsBasis(config.aiu);
  const base = basis === 'contract' ? contract_value : aiu_value;
  const parts = AIU_EMISSION_ORDER.map((component) => {
    const share = toDecimal(config.aiu?.components?.[component]);
    const exact = base.times(share).dividedBy(100);
    const truncated = toDecimal(dianAmount(exact));
    return {
      component,
      exact,
      amount: truncated,
      remainder: exact.minus(truncated),
    };
  });

  const target = toDecimal(
    dianAmount(
      parts.reduce((acc, part) => acc.plus(part.exact), toDecimal(0)),
    ),
  );
  let residue = parts.reduce((acc, part) => acc.minus(part.amount), target);
  const byLargestRemainder = [...parts].sort((a, b) => {
    const byRemainder = b.remainder.comparedTo(a.remainder);
    if (byRemainder !== 0) return byRemainder;
    return (
      AIU_RESIDUE_PRIORITY.indexOf(a.component) -
      AIU_RESIDUE_PRIORITY.indexOf(b.component)
    );
  });

  for (const part of byLargestRemainder) {
    if (residue.lessThan(ONE_CENT)) break;
    part.amount = part.amount.plus(ONE_CENT);
    residue = residue.minus(ONE_CENT);
  }
  return new Map(parts.map((part) => [part.component, part.amount]));
}

/** Shared preview/profile rule mapping: taxable true creates a tax; zero-rate
 * taxable is retained, while excluded rules produce no tax entry. */
export function profileLineToCalculatorLine(
  line: Pick<ProfileContractInvoiceLine, 'bucket' | 'description' | 'quantity' | 'unit_price' | 'discount_amount'>,
  config: InvoiceProfileConfig,
): InvoiceCalculatorLineInput {
  const bucket = line.bucket === 'contrato' ? 'costo' : line.bucket;
  const rule = config.taxes.rules.find((candidate) => candidate.bucket === bucket);
  const aiuComponent = bucket === 'costo' ? null : bucket;
  return {
    description: line.description,
    aiu_component: line.bucket === 'contrato' ? 'contrato' : aiuComponent,
    quantity: line.quantity,
    unit_price: line.unit_price,
    discount_amount: line.discount_amount,
    ...(rule?.taxable
      ? {
          taxes: [
            {
              tax_name: DIAN_TAX_NAMES[rule.tax_code] || rule.tax_code,
              tax_rate: rule.rate,
              tax_type: TAX_TYPE_BY_DIAN_CODE[rule.tax_code],
            },
          ],
        }
      : {}),
  };
}

export function profileModelDescription(config: InvoiceProfileConfig, bucket: AiuBucket): string {
  const model = config.model_lines.find((line) => line.bucket === bucket);
  return (model?.description || '').trim() || profileBucketDefaultDescription(bucket);
}

export function profileBucketDefaultDescription(bucket: AiuBucket): string {
  return BUCKET_DEFAULT_DESCRIPTION[bucket];
}

export function profileModelUnitCode(config: InvoiceProfileConfig, bucket: AiuBucket): string {
  const model = config.model_lines.find((line) => line.bucket === bucket);
  return (model?.unit_code || '').trim() || DIAN_UNIT_CODES.EACH;
}

function fail(message: string, details?: Record<string, unknown>): never {
  throw new VendixHttpException(ErrorCodes.INVOICING_AIU_007, message, details);
}

function toDecimalMoney(value: string | number | undefined): Prisma.Decimal {
  return toDecimal(value ?? 0);
}

function costLineTax(line: ProfileContractCostLine, config: InvoiceProfileConfig): ProfileContractInvoiceLine {
  const quantity = toDecimal(line.quantity);
  const unitPrice = toDecimal(line.unit_price);
  const discount = toDecimal(line.discount_amount ?? 0);
  const extension = toDecimal(
    dianLineExtension({
      quantity,
      unit_price: unitPrice,
      discount_amount: discount,
    }),
  );
  if (
    !quantity.greaterThan(0) ||
    unitPrice.isNegative() ||
    discount.isNegative() ||
    extension.isNegative()
  ) {
    fail('La línea de costo debe tener cantidad positiva, valores no negativos y descuento no superior al importe bruto.', {
      description: line.description,
    });
  }
  return {
    bucket: 'costo',
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unit_price,
    discount_amount: line.discount_amount ?? 0,
    unit_code: line.unit_code || profileModelUnitCode(config, 'costo'),
  };
}

function deriveSumadaComponents(
  config: InvoiceProfileConfig,
  contractValue: Prisma.Decimal,
  aiuValue: Prisma.Decimal,
): ProfileContractInvoiceLine[] {
  const portions = splitAiuByComponents(aiuValue, contractValue, config);
  return AIU_EMISSION_ORDER.map((bucket) => ({
    bucket,
    description: profileModelDescription(config, bucket),
    quantity: '1',
    unit_price: dianAmount(portions.get(bucket) ?? toDecimal(0)),
    discount_amount: '0',
    unit_code: profileModelUnitCode(config, bucket),
  }));
}

function resolveContractTax(config: InvoiceProfileConfig): {
  tax_name: string;
  tax_rate: string;
  tax_type?: string;
} | null {
  const basis = resolveAiuTaxableBasis(config.aiu);
  const buckets: readonly AiuBucket[] =
    basis === 'utilidad'
      ? ['utilidad']
      : basis === 'aiu'
        ? ['administracion', 'imprevistos', 'utilidad']
        : ['costo', 'administracion', 'imprevistos', 'utilidad'];
  const rules = buckets.map((bucket) =>
    config.taxes.rules.find((rule) => rule.bucket === bucket),
  );
  if (rules.some((rule) => !rule)) {
    fail('La matriz fiscal del perfil no define todas las porciones gravables del contrato.', {
      taxable_basis: basis,
      buckets,
    });
  }
  const taxable = rules.filter((rule) => rule!.taxable);
  if (taxable.length === 0) return null;
  if (
    taxable.length !== rules.length ||
    taxable.some(
      (rule) =>
        rule!.tax_code !== taxable[0]!.tax_code ||
        rule!.rate !== taxable[0]!.rate,
    )
  ) {
    fail(
      'El modelo no sumado necesita una única tarifa y código fiscal para todas las porciones gravables; usa el modelo sumado o un perfil con reglas homogéneas.',
      { taxable_basis: basis, buckets },
    );
  }
  const rule = taxable[0]!;
  return {
    tax_name: DIAN_TAX_NAMES[rule.tax_code] || rule.tax_code,
    tax_rate: rule.rate,
    tax_type: TAX_TYPE_BY_DIAN_CODE[rule.tax_code],
  };
}

/**
 * Build the immutable invoice representation and run the canonical DIAN
 * calculator using the exact versioned billing-profile configuration.
 */
export function calculateProfileContractEconomics(
  config: InvoiceProfileConfig,
  costLines: readonly ProfileContractCostLine[],
  explicitAiuValue?: string | number,
): ProfileContractEconomicsResult {
  if (!config.aiu) {
    fail('El perfil seleccionado no contiene una configuración AIU (operación 09).');
  }

  const cost = costLines.map((line) => costLineTax(line, config));
  const directCost = toDecimal(dianSum(
    cost.map((line) =>
      dianLineExtension({
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount_amount: line.discount_amount,
      }),
    ),
  ));
  const componentsBasis = resolveAiuComponentsBasis(config.aiu);
  const percentSum = AIU_EMISSION_ORDER.reduce(
    (sum, component) => sum.plus(toDecimal(config.aiu!.components[component])),
    toDecimal(0),
  );

  const accountingModel = resolveAccountingModel(config.aiu);
  let aiuValue: Prisma.Decimal;
  let contractValue: Prisma.Decimal;
  if (componentsBasis === 'contract') {
    const remainder = toDecimal(100).minus(percentSum).dividedBy(100);
    if (remainder.isNegative()) {
      fail('La suma AIU del perfil supera el valor del contrato.');
    }
    if (remainder.isZero()) {
      if (!directCost.isZero()) fail('No se puede derivar el valor del contrato con 100% AIU y costo directo mayor que cero.');
      if (accountingModel === 'no_sumada') {
        if (explicitAiuValue == null || !toDecimalMoney(explicitAiuValue).greaterThan(0)) {
          fail('Con costo directo cero y porcentajes AIU del 100%, indica un valor AIU explícito mayor que cero.');
        }
        contractValue = toDecimal(dianAmount(toDecimalMoney(explicitAiuValue)));
      } else {
        if (explicitAiuValue != null) {
          fail('explicitAiuValue sólo se admite cuando los porcentajes se miden sobre el AIU.');
        }
        contractValue = toDecimal(0);
      }
    } else {
      if (explicitAiuValue != null) {
        fail('explicitAiuValue sólo se admite cuando los porcentajes se miden sobre el AIU.');
      }
      contractValue = directCost.dividedBy(remainder);
      // Modelo 1 explodes the invoice contract line internally, truncating
      // each embedded portion. Round the inverse up to the next cent so the
      // calculator's canonical embedded-cost portion can still equal the
      // original direct cost (e.g. 100 / 0.90 => 111.12, not 111.11).
      if (accountingModel === 'no_sumada') {
        contractValue = contractValue.times(100).ceil().dividedBy(100);
      }
    }
    contractValue = toDecimal(dianAmount(contractValue));
    if (accountingModel === 'no_sumada') {
      aiuValue = toDecimal(dianAmount(contractValue.minus(directCost)));
    } else {
      const portions = splitAiuByComponents(toDecimal(0), contractValue, config);
      aiuValue = toDecimal(dianSum([...portions.values()].map((value) => dianAmount(value))));
    }
  } else {
    if (explicitAiuValue == null) {
      fail('El perfil mide los porcentajes sobre el AIU: indica explícitamente el valor AIU acordado; no se deriva del piso legal.');
    }
    aiuValue = toDecimal(dianAmount(toDecimalMoney(explicitAiuValue)));
    if (aiuValue.isNegative()) fail('El valor AIU explícito no puede ser negativo.');
    if (accountingModel === 'no_sumada' && !directCost.isZero()) {
      fail('El modelo no sumado no puede representar costo directo más AIU cuando los porcentajes miden el AIU; usa base por porcentajes de contrato o modelo sumado.');
    }
    contractValue = toDecimal(dianAmount(directCost.plus(aiuValue)));
  }

  let invoiceLines: ProfileContractInvoiceLine[];
  if (accountingModel === 'no_sumada') {
    const description = costLines.map((line) => line.description.trim()).filter(Boolean).join('; ') || profileModelDescription(config, 'costo');
    const tax = resolveContractTax(config);
    invoiceLines = [{
      bucket: 'contrato',
      description,
      quantity: '1',
      unit_price: dianAmount(contractValue),
      discount_amount: '0',
      unit_code: profileModelUnitCode(config, 'costo'),
      aiu_component: 'contrato',
      ...(tax ? { taxes: [tax] } : {}),
    }];
  } else {
    invoiceLines = [
      ...cost,
      ...deriveSumadaComponents(config, contractValue, aiuValue),
    ].map((line) => ({ ...line, ...profileLineToCalculatorLine(line, config) }));
  }

  const calculator = new InvoiceCalculatorService();
  const calculation = calculator.calculate({
    items: invoiceLines,
    aiu: {
      taxable_basis: resolveAiuTaxableBasis(config.aiu),
      enforce_minimum_base: config.aiu.enforce_minimum_base,
      minimum_base_percent: config.aiu.minimum_base_percent,
      components: config.aiu.components,
      components_basis: componentsBasis,
    },
  });
  const aiuSummary = calculation.aiu;
  if (!aiuSummary || !toDecimal(aiuSummary.contract_value).equals(contractValue)) {
    fail('El cálculo canónico no coincide con el valor económico derivado del perfil.', {
      expected_contract_value: dianAmount(contractValue),
      calculated_contract_value: aiuSummary?.contract_value ?? null,
    });
  }
  if (!toDecimal(aiuSummary.aiu_value).equals(aiuValue)) {
    fail('El reparto AIU no cierra al centavo con el valor económico derivado del perfil.', {
      expected_aiu_value: dianAmount(aiuValue),
      calculated_aiu_value: aiuSummary.aiu_value,
    });
  }
  const reconciledValue = toDecimal(dianAmount(directCost.plus(aiuValue)));
  if (!reconciledValue.equals(contractValue)) {
    fail('El costo directo más el AIU no concilian al centavo con el valor del contrato.', {
      direct_cost: dianAmount(directCost),
      aiu_value: dianAmount(aiuValue),
      contract_value: dianAmount(contractValue),
      reconciled_value: dianAmount(reconciledValue),
    });
  }
  const floor = calculation.divergences.find((item) => item.scope === 'aiu_base_below_minimum');
  if (floor) {
    throw new VendixHttpException(ErrorCodes.INVOICING_AIU_001, undefined, {
      aiu_value: floor.received,
      minimum_base: floor.expected,
      difference: floor.difference,
    });
  }
  const invalidLine = calculation.divergences.find((item) => item.scope === 'invalid_line_input');
  if (invalidLine) {
    fail('Una línea económica del contrato no es válida para el calculador fiscal.', {
      line_index: invalidLine.line_index,
      line_description: invalidLine.line_description,
      received: invalidLine.received,
    });
  }
  const missingTax = calculation.divergences.find((item) => item.scope === 'aiu_taxable_line_without_tax');
  if (missingTax) {
    throw new VendixHttpException(ErrorCodes.INVOICING_AIU_004, undefined, {
      line_index: missingTax.line_index,
      line_description: missingTax.line_description,
      tax_type: missingTax.tax_type,
    });
  }

  return {
    invoice_lines: invoiceLines,
    calculation,
    direct_cost: dianAmount(directCost),
    contract_value: aiuSummary.contract_value,
    aiu_value: aiuSummary.aiu_value,
  };
}
