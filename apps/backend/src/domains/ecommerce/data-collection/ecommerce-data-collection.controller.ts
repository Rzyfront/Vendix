import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '@common/decorators/public.decorator';
import { SubmissionsService } from '../../store/data-collection/submissions.service';
import { SubmitStepResponseDto } from '../../store/data-collection/dto/submit-response.dto';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { DOCUMENT_MAX_SIZE_MB_LIMIT } from '../../store/data-collection/template-json/template-json.contract';

@Controller('ecommerce/data-collection')
export class EcommerceDataCollectionController {
  constructor(
    private readonly submissionsService: SubmissionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get(':token')
  async getByToken(@Param('token') token: string) {
    const result = await this.submissionsService.getByToken(token);
    return this.responseService.success(result);
  }

  @Public()
  @Post(':token/step/:stepIndex')
  async saveStep(
    @Param('token') token: string,
    @Param('stepIndex', ParseIntPipe) stepIndex: number,
    @Body() dto: SubmitStepResponseDto,
  ) {
    const result = await this.submissionsService.saveStepResponses(
      token,
      stepIndex,
      dto.responses,
    );
    return this.responseService.success(result, 'Paso guardado correctamente');
  }

  @Public()
  @Post(':token/submit')
  async submitFinal(@Param('token') token: string) {
    const result = await this.submissionsService.submitFinal(token);
    return this.responseService.success(
      result,
      'Formulario enviado correctamente',
    );
  }

  /**
   * Public attachment upload. Multipart `file` plus an optional `field_id`:
   * with it the file is validated against the documents field of the form;
   * without it the legacy behavior applies. Multer caps every file at the hard
   * ceiling (a larger one answers 413 before reaching the service).
   */
  @Public()
  @Post(':token/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DOCUMENT_MAX_SIZE_MB_LIMIT * 1024 * 1024 },
    }),
  )
  async uploadFile(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('field_id') fieldIdRaw?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    let fieldId: number | undefined;
    if (fieldIdRaw !== undefined && fieldIdRaw !== null && `${fieldIdRaw}` !== '') {
      fieldId = Number(fieldIdRaw);
      if (!Number.isInteger(fieldId) || fieldId <= 0) {
        throw new VendixHttpException(ErrorCodes.DCOL_UPLOAD_003);
      }
    }
    const result = await this.submissionsService.uploadDocument(
      token,
      file,
      fieldId,
    );
    return this.responseService.success(result, 'Archivo subido correctamente');
  }
}
