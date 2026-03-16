import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { DianSoapClient } from '../providers/dian-direct/dian-soap.client';
import { DianResponseParserService } from '../providers/dian-direct/dian-response-parser.service';

@Injectable()
export class DianTestService {
  private readonly logger = new Logger(DianTestService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly soap_client: DianSoapClient,
    private readonly response_parser: DianResponseParserService,
  ) {}

  private async getConfigById(config_id: number) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id: config_id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    return config;
  }

  /**
   * Tests connectivity to DIAN web services for a specific configuration.
   */
  async testConnection(config_id: number) {
    const config = await this.getConfigById(config_id);
    const environment = config.environment as 'test' | 'production';

    try {
      const response = await this.soap_client.getStatus(
        '00000000-0000-0000-0000-000000000000',
        environment,
      );

      const is_connected = response.raw_response.length > 0;

      await this.createAuditLog(config.id, {
        action: 'test_connection',
        status: is_connected ? 'success' : 'error',
        error_message: is_connected ? null : 'No response from DIAN',
        duration_ms: response.duration_ms,
      });

      return {
        success: is_connected,
        environment,
        response_time_ms: response.duration_ms,
        message: is_connected
          ? 'Conexión exitosa con los servicios de la DIAN'
          : 'No se pudo conectar con los servicios de la DIAN',
        dian_status: response.status_code,
      };
    } catch (error) {
      this.logger.error(
        `DIAN connection test failed: ${error.message}`,
      );

      await this.createAuditLog(config.id, {
        action: 'test_connection',
        status: 'error',
        error_message: error.message,
      });

      throw new VendixHttpException(ErrorCodes.DIAN_CONN_001);
    }
  }

  /**
   * Runs the DIAN test set for a specific configuration.
   */
  async runTestSet(config_id: number) {
    const config = await this.getConfigById(config_id);

    if (!config.test_set_id) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No test set ID configured. Set the test_set_id first.',
      );
    }

    // TODO: Implement full test set execution
    return {
      success: false,
      message:
        'Test set execution not yet implemented. This will generate ' +
        'and send the required test invoices to DIAN for enablement.',
      test_set_id: config.test_set_id,
      environment: config.environment,
    };
  }

  /**
   * Gets the test results for a specific DIAN configuration.
   */
  async getTestResults(config_id: number) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id: config_id },
      select: {
        id: true,
        enablement_status: true,
        environment: true,
        test_set_id: true,
        last_test_result: true,
      },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    return {
      enablement_status: config.enablement_status,
      environment: config.environment,
      test_set_id: config.test_set_id,
      last_result: config.last_test_result,
    };
  }

  private async createAuditLog(
    dian_configuration_id: number,
    data: {
      action: string;
      status: string;
      error_message?: string | null;
      duration_ms?: number;
    },
  ): Promise<void> {
    try {
      await this.prisma.dian_audit_logs.create({
        data: {
          dian_configuration_id,
          ...data,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create DIAN audit log: ${error.message}`,
      );
    }
  }
}
