import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { S3Service } from '../../../../common/services/s3.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CreateDianConfigDto } from './dto/create-dian-config.dto';
import { UpdateDianConfigDto } from './dto/update-dian-config.dto';
import { DianXmlSignerService } from '../providers/dian-direct/dian-xml-signer.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Controller('store/invoicing/dian-config')
export class DianConfigController {
  constructor(
    private readonly dian_config_service: DianConfigService,
    private readonly dian_test_service: DianTestService,
    private readonly xml_signer: DianXmlSignerService,
    private readonly response_service: ResponseService,
    private readonly s3_service: S3Service,
  ) {}

  @Get('dashboard')
  @Permissions('invoicing:read')
  async getDashboard() {
    const result = await this.dian_config_service.getDashboard();
    return this.response_service.success(result);
  }

  @Get()
  @Permissions('invoicing:read')
  async getConfigs() {
    const result = await this.dian_config_service.getConfigs();
    return this.response_service.success(result);
  }

  @Get('audit-logs')
  @Permissions('invoicing:read')
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('config_id') config_id?: string,
  ) {
    const result = await this.dian_config_service.getAuditLogs(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      config_id ? parseInt(config_id, 10) : undefined,
    );
    return this.response_service.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Get(':id')
  @Permissions('invoicing:read')
  async getConfigById(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.getConfigById(id);
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

  @Delete(':id')
  @Permissions('invoicing:write')
  async deleteConfig(@Param('id', ParseIntPipe) id: number) {
    await this.dian_config_service.deleteConfig(id);
    return this.response_service.success(null, 'Configuration deleted');
  }

  @Patch(':id/set-default')
  @Permissions('invoicing:write')
  async setDefault(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.setDefault(id);
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
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_001, validation.error);
    }

    const s3_key = `dian/certificates/${config_id}/certificate.p12`;
    await this.s3_service.uploadFile(
      file.buffer,
      s3_key,
      'application/x-pkcs12',
    );

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

  @Post(':id/test-connection')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_test_service.testConnection(id);
    return this.response_service.success(result);
  }

  @Post(':id/run-test-set')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async runTestSet(
    @Param('id', ParseIntPipe) id: number,
    @Body('resolution_id', ParseIntPipe) resolution_id: number,
  ) {
    const result = await this.dian_test_service.runTestSet(id, resolution_id);
    return this.response_service.success(result);
  }

  @Get(':id/test-results')
  @Permissions('invoicing:read')
  async getTestResults(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_test_service.getTestResults(id);
    return this.response_service.success(result);
  }
}
