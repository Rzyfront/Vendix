import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { WithholdingCalculationResult } from './interfaces/withholding.interface';
import { deriveCounterpartyType } from './withholding-classification.util';

@Injectable()
export class WithholdingCalculatorService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Fetch the organization UVT value (COP) for a given year.
   * Shared by the calculator and the resolver so UVT lookup logic lives once.
   * Throws WHT_UVT_NOT_FOUND when missing (existing behavior preserved).
   */
  async getUvtValue(organization_id: number, year: number): Promise<number> {
    const uvt = await this.prisma.uvt_values.findFirst({
      where: { organization_id, year },
    });

    if (!uvt) {
      throw new VendixHttpException(ErrorCodes.WHT_UVT_NOT_FOUND);
    }

    return Number(uvt.value_cop);
  }

  async calculateWithholding(params: {
    amount: number;
    concept_code: string;
    /**
     * Pre-derived counterparty type. Prefer `supplier` for automatic derivation;
     * this param is kept for back-compat with manual callers (controller/service).
     */
    supplier_type?: string;
    /**
     * Optional supplier record. When provided (and `supplier_type` is not),
     * the counterparty type is derived deterministically from the supplier's
     * tax_regime / person_type via `deriveCounterpartyType`.
     */
    supplier?: { tax_regime?: string | null; person_type?: string | null };
    organization_id: number;
    year?: number;
  }): Promise<WithholdingCalculationResult> {
    const { amount, concept_code, organization_id } = params;
    const year = params.year || new Date().getFullYear();

    // Derive the counterparty type from the supplier record when no explicit
    // supplier_type was passed, keeping the manual-param path working.
    const supplier_type =
      params.supplier_type ??
      (params.supplier
        ? deriveCounterpartyType(
            params.supplier.tax_regime,
            params.supplier.person_type,
          )
        : undefined);

    // 1. Get current year UVT value for the organization
    const uvt_value = await this.getUvtValue(organization_id, year);

    // 2. Find active withholding concept by code for the organization
    const concept = await this.prisma.withholding_concepts.findFirst({
      where: {
        organization_id,
        code: concept_code,
        is_active: true,
      },
    });

    if (!concept) {
      throw new VendixHttpException(ErrorCodes.WHT_CONCEPT_NOT_FOUND);
    }

    const rate = Number(concept.rate);
    const min_uvt_threshold = Number(concept.min_uvt_threshold);
    const withholding_type =
      concept.withholding_type as WithholdingCalculationResult['withholding_type'];
    const account_code = concept.account_code ?? null;

    // 3. Calculate threshold in COP
    const threshold_cop = min_uvt_threshold * uvt_value;

    // 4. Check if amount meets the minimum threshold
    if (amount < threshold_cop) {
      return {
        applies: false,
        withholding_amount: 0,
        rate,
        uvt_threshold_cop: threshold_cop,
        concept_code: concept.code,
        concept_name: concept.name,
        withholding_type,
        account_code,
      };
    }

    // 5. Check supplier type filter
    const filter = concept.supplier_type_filter as string;
    if (filter !== 'any' && supplier_type && supplier_type !== filter) {
      return {
        applies: false,
        withholding_amount: 0,
        rate,
        uvt_threshold_cop: threshold_cop,
        concept_code: concept.code,
        concept_name: concept.name,
        withholding_type,
        account_code,
      };
    }

    // 6. Calculate and return the withholding
    const withholding_amount = Math.round(amount * rate * 100) / 100;

    return {
      applies: true,
      withholding_amount,
      rate,
      uvt_threshold_cop: threshold_cop,
      concept_code: concept.code,
      concept_name: concept.name,
      withholding_type,
      account_code,
    };
  }
}
