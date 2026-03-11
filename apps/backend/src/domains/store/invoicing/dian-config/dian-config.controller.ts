import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DianConfigService } from './dian-config.service';
import { DianTestService } from './dian-test.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CreateDianConfigDto } from './dto/create-dian-config.dto';
import { UpdateDianConfigDto } from './dto/update-dian-config.dto';
import { DianXmlSignerService } from '../providers/dian-direct/dian-xml-signer.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Controller for DIAN configuration endpoints.
 * Manages the store's DIAN electronic invoicing setup.
 */
@Controller('store/invoicing/dian-config')
export class DianConfigController {
  constructor(
    private readonly dian_config_service: DianConfigService,
    private readonly dian_test_service: DianTestService,
    private readonly xml_signer: DianXmlSignerService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('invoicing:read')
  async getConfig() {
    const result = await this.dian_config_service.getConfig();
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateDianConfigDto) {
    const result = await this.dian_config_service.create(dto);
    return this.response_service.success(result);
  }

  @Patch(':id')
  @Permissions('invoicing:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDianConfigDto,
  ) {
    const result = await this.dian_config_service.update(id, dto);
    return this.response_service.success(result);
  }

  /**
   * Upload a .p12 certificate file.
   * Validates the certificate and stores it encrypted.
   */
  @Post('upload-certificate')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('certificate'))
  async uploadCertificate(
    @UploadedFile() file: Express.Multer.File,
    @Body('password') password: string,
    @Body('config_id') config_id: string,
  ) {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_001);
    }

    if (!password) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CERT_002,
        'Certificate password is required',
      );
    }

    // Validate the certificate
    const validation = await this.xml_signer.validateCertificate(
      file.buffer,
      password,
    );

    if (!validation.valid) {
      if (validation.error?.includes('expired')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_003);
      }
      if (validation.error?.includes('password')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_002);
      }
      throw new VendixHttpException(
        ErrorCodes.DIAN_CERT_001,
        validation.error,
      );
    }

    // TODO: Upload to S3 using S3 service
    // For now, store a placeholder path
    const s3_key = `dian/certificates/${config_id}/certificate.p12`;

    const result = await this.dian_config_service.updateCertificate(
      parseInt(config_id, 10),
      s3_key,
      password,
      validation.expires || null,
    );

    return this.response_service.success({
      ...result,
      certificate_info: {
        subject: validation.subject,
        issuer: validation.issuer,
        expires: validation.expires,
      },
    });
  }

  /**
   * Tests connectivity to DIAN web services.
   */
  @Post('test-connection')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async testConnection() {
    const result = await this.dian_test_service.testConnection();
    return this.response_service.success(result);
  }

  /**
   * Runs the DIAN test set for enablement.
   */
  @Post('run-test-set')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async runTestSet() {
    const result = await this.dian_test_service.runTestSet();
    return this.response_service.success(result);
  }

  /**
   * Gets test results from the last test set execution.
   */
  @Get('test-results')
  @Permissions('invoicing:read')
  async getTestResults() {
    const result = await this.dian_test_service.getTestResults();
    return this.response_service.success(result);
  }

  /**
   * Gets audit logs for DIAN operations.
   */
  @Get('audit-logs')
  @Permissions('invoicing:read')
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.dian_config_service.getAuditLogs(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
    return this.response_service.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }
}
