import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { legal_document_type_enum } from '@prisma/client';
import { Public } from '../../../common/decorators/public.decorator';
import { ResponseService, SuccessResponse } from '@common/responses';
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../common/errors/error-codes';
import {
  PublicLegalService,
  PublicLegalDocumentDto,
} from './public-legal.service';

const VALID_DOCUMENT_TYPES = new Set<string>(
  Object.values(legal_document_type_enum),
);

/**
 * 📜 PublicLegalController
 *
 * Provides unauthenticated access to the active system (platform) legal
 * documents. Used by the marketing/landing page to render Terms, Privacy, and
 * Cookies straight from the database.
 *
 * Security notes:
 * - @Public() bypasses JWT guard (intentional — platform legal docs are public).
 * - @Throttle limits to 100 requests/min per IP to prevent DDoS/scraping.
 * - Service layer whitelists only safe public fields (no internal metadata).
 *
 * Route: GET /api/public/legal/:documentType
 */
@Controller('public/legal')
export class PublicLegalController {
  private readonly logger = new Logger(PublicLegalController.name);

  constructor(
    private readonly publicLegalService: PublicLegalService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * GET /api/public/legal/:documentType
   *
   * Returns the active system legal document for the given type with
   * public-safe fields only. Rate-limited to 100 requests per minute per IP.
   *
   * - 400 if documentType is not a valid legal_document_type_enum value.
   * - 404 if the type is valid but no active version exists.
   */
  @Public()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @Get(':documentType')
  @HttpCode(HttpStatus.OK)
  async getActiveDocument(
    @Param('documentType') documentType: string,
  ): Promise<SuccessResponse<PublicLegalDocumentDto>> {
    this.logger.log(`GET /public/legal/${documentType} — public legal request`);

    if (!VALID_DOCUMENT_TYPES.has(documentType)) {
      throw new VendixHttpException(
        ErrorCodes.LEGAL_DOCUMENT_TYPE_INVALID,
        undefined,
        { document_type: documentType },
      );
    }

    const document = await this.publicLegalService.getActiveSystemDocument(
      documentType as legal_document_type_enum,
    );

    if (!document) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'No active version exists for this legal document type',
        { document_type: documentType },
      );
    }

    return this.responseService.success(
      document,
      'Legal document retrieved successfully',
    );
  }
}
