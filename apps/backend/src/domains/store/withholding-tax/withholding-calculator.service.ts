import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { WithholdingCalculationResult } from './interfaces/withholding.interface';

@Injectable()
export class WithholdingCalculatorService {
  constructor(private readonly prisma: StorePrismaService) {}

  async calculateWithholding(params: {
    amount: number;
    concept_code: string;
    supplier_type?: string;
    organization_id: number;
    year?: number;
  }): Promise<WithholdingCalculationResult> {
    const { amount, concept_code, supplier_type, organization_id } = params;
    const year = params.year || new Date().getFullYear();

    // 1. Get current year UVT value for the organization
    const uvt = await this.prisma.uvt_values.findFirst({
      where: {
        organization_id,
        year,
      },
    });

    if (!uvt) {
      throw new VendixHttpException(ErrorCodes.WHT_UVT_NOT_FOUND);
    }

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

    const uvt_value = Number(uvt.value_cop);
    const rate = Number(concept.rate);
    const min_uvt_threshold = Number(concept.min_uvt_threshold);

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
    };
  }
}
