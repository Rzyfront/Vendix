import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
  type Dimension,
} from '@aws-sdk/client-cloudwatch';
import { VendixHttpException } from '../../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../../common/errors/error-codes';
import {
  AWS_REGION_DEFAULT,
  EC2_INSTANCE_ID_DEFAULT,
  RDS_DB_IDENTIFIER_DEFAULT,
} from '../constants/cloudwatch.constants';

export interface MetricDataResult {
  timestamps: string[];
  values: number[];
}

export interface MetricQuery {
  id: string;
  metricName: string;
  namespace: string;
  dimensions: Dimension[];
  stat?: string;
}

@Injectable()
export class CloudWatchService {
  private readonly logger = new Logger(CloudWatchService.name);
  private readonly client: CloudWatchClient;
  private readonly CLOUDWATCH_TIMEOUT = 8_000;
  readonly ec2InstanceId: string;
  readonly rdsDbIdentifier: string;

  constructor(private readonly configService: ConfigService) {
    const region =
      this.configService.get<string>('AWS_REGION') || AWS_REGION_DEFAULT;
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );

    const clientConfig: any = { region };
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }

    this.client = new CloudWatchClient(clientConfig);
    this.ec2InstanceId =
      this.configService.get<string>('EC2_INSTANCE_ID') ||
      EC2_INSTANCE_ID_DEFAULT;
    this.rdsDbIdentifier =
      this.configService.get<string>('RDS_DB_IDENTIFIER') ||
      RDS_DB_IDENTIFIER_DEFAULT;
  }

  async getMetricData(params: {
    metricName: string;
    namespace: string;
    dimensions: Dimension[];
    startTime: Date;
    endTime: Date;
    period: number;
    stat?: string;
  }): Promise<MetricDataResult> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.CLOUDWATCH_TIMEOUT,
    );
    try {
      const command = new GetMetricDataCommand({
        StartTime: params.startTime,
        EndTime: params.endTime,
        MetricDataQueries: [
          {
            Id: 'metric_query',
            MetricStat: {
              Metric: {
                MetricName: params.metricName,
                Namespace: params.namespace,
                Dimensions: params.dimensions,
              },
              Period: params.period,
              Stat: params.stat || 'Average',
            },
          },
        ],
      });

      const response = await this.client.send(command, {
        abortSignal: controller.signal,
      });
      const result = response.MetricDataResults?.[0];

      return {
        timestamps: (result?.Timestamps || []).map((t) => t.toISOString()),
        values: result?.Values || [],
      };
    } catch (error) {
      if (error.name === 'AbortError' || controller.signal.aborted) {
        this.logger.warn(
          `CloudWatch getMetricData timed out after ${this.CLOUDWATCH_TIMEOUT}ms for ${params.metricName}`,
        );
        return { timestamps: [], values: [] };
      }
      this.logger.error(
        `CloudWatch getMetricData failed: ${error.message}`,
        error.stack,
      );
      throw new VendixHttpException(
        ErrorCodes.MON_CW_001,
        `CloudWatch query failed for ${params.metricName}: ${error.message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getMultipleMetrics(
    queries: MetricQuery[],
    startTime: Date,
    endTime: Date,
    period: number,
  ): Promise<Map<string, MetricDataResult>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.CLOUDWATCH_TIMEOUT,
    );
    try {
      const metricDataQueries: MetricDataQuery[] = queries.map((q) => ({
        Id: q.id,
        MetricStat: {
          Metric: {
            MetricName: q.metricName,
            Namespace: q.namespace,
            Dimensions: q.dimensions,
          },
          Period: period,
          Stat: q.stat || 'Average',
        },
      }));

      const command = new GetMetricDataCommand({
        StartTime: startTime,
        EndTime: endTime,
        MetricDataQueries: metricDataQueries,
      });

      const response = await this.client.send(command, {
        abortSignal: controller.signal,
      });
      const resultMap = new Map<string, MetricDataResult>();

      for (const result of response.MetricDataResults || []) {
        if (result.Id) {
          resultMap.set(result.Id, {
            timestamps: (result.Timestamps || []).map((t) => t.toISOString()),
            values: result.Values || [],
          });
        }
      }

      return resultMap;
    } catch (error) {
      if (error.name === 'AbortError' || controller.signal.aborted) {
        this.logger.warn(
          `CloudWatch getMultipleMetrics timed out after ${this.CLOUDWATCH_TIMEOUT}ms`,
        );
        return new Map();
      }
      this.logger.error(
        `CloudWatch getMultipleMetrics failed: ${error.message}`,
        error.stack,
      );
      throw new VendixHttpException(
        ErrorCodes.MON_CW_001,
        `CloudWatch batch query failed: ${error.message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
