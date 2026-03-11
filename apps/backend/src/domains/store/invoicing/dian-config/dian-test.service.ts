import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { DianSoapClient } from '../providers/dian-direct/dian-soap.client';
import { DianResponseParserService } from '../providers/dian-direct/dian-response-parser.service';

/**
 * Service for testing DIAN connectivity and running test sets.
 */
@Injectable()
export class DianTestService {
  private readonly logger = new Logger(DianTestService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly soap_client: DianSoapClient,
    private readonly response_parser: DianResponseParserService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  /**
   * Tests connectivity to DIAN web services.
   * Sends a minimal GetStatus request to verify the endpoint is reachable.
   */
  async testConnection() {
    const context = this.getContext();

    const config = await this.prisma.dian_configurations.findFirst({
      where: { store_id: context.store_id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    const environment = config.environment as 'test' | 'production';

    try {
      // Send a GetStatus with a dummy tracking ID to test connectivity
      const response = await this.soap_client.getStatus(
        '00000000-0000-0000-0000-000000000000',
        environment,
      );

      // If we get a SOAP response (even with an error), connectivity is OK
      const is_connected = response.raw_response.length > 0;

      // Create audit log
      await this.createAuditLog(config.id, {
        action: 'test_connection',
        status: is_connected ? 'success' : 'error',
        error_message: is_connected
          ? null
          : 'No response from DIAN',
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
   * Runs the DIAN test set (set de pruebas) for enablement.
   */
  async runTestSet() {
    const context = this.getContext();

    const config = await this.prisma.dian_configurations.findFirst({
      where: { store_id: context.store_id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    if (!config.test_set_id) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No test set ID configured. Set the test_set_id first.',
      );
    }

    // TODO: Implement full test set execution
    // This requires generating multiple test invoices/credit notes
    // and sending them via SendTestSetAsync
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
   * Gets the test results for the current store's DIAN configuration.
   */
  async getTestResults() {
    const context = this.getContext();

    const config = await this.prisma.dian_configurations.findFirst({
      where: { store_id: context.store_id },
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
