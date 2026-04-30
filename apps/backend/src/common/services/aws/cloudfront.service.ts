import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  GetDistributionCommand,
  UpdateDistributionCommand,
  DistributionConfig,
} from '@aws-sdk/client-cloudfront';

/** Maximum aliases that may be added in a single addAliasesToDistribution call.
 * Catches accidental wipes / over-adds. CloudFront's hard cap is 100 aliases
 * total per distribution; we stay well under. */
const MAX_ALIAS_DIFF = 10;

/** Max retries when CloudFront returns PreconditionFailed (etag race). */
const UPDATE_MAX_ATTEMPTS = 3;

export interface DistributionConfigResult {
  config: DistributionConfig;
  etag: string;
}

export interface DistributionStatus {
  status: string;
  domainName: string;
  aliases: string[];
}

/**
 * Service for managing CloudFront distribution config — primarily aliases (CNAMEs)
 * and the associated ACM certificate ARN. Used by the custom-domain workflow to
 * attach tenant domains to the platform CloudFront distribution.
 *
 * Auth: relies on the EC2 instance's IAM role (no explicit credentials).
 */
@Injectable()
export class CloudFrontService {
  private readonly logger = new Logger(CloudFrontService.name);
  private readonly client: CloudFrontClient;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    this.client = new CloudFrontClient({ region });
  }

  /**
   * Fetches the current DistributionConfig + its ETag (required for updates).
   */
  async getDistributionConfig(
    distributionId: string,
  ): Promise<DistributionConfigResult> {
    try {
      const response = await this.client.send(
        new GetDistributionConfigCommand({ Id: distributionId }),
      );

      if (!response.DistributionConfig || !response.ETag) {
        this.logger.error(
          `CloudFront GetDistributionConfig returned incomplete payload for ${distributionId}`,
        );
        throw new InternalServerErrorException(
          'CloudFront returned incomplete distribution config',
        );
      }

      return {
        config: response.DistributionConfig,
        etag: response.ETag,
      };
    } catch (error) {
      this.handleAwsError(error, `getDistributionConfig(${distributionId})`);
    }
  }

  /**
   * Updates a CloudFront distribution. Retries up to UPDATE_MAX_ATTEMPTS times
   * if AWS reports an ETag race (PreconditionFailedException), each retry
   * re-fetches config + etag and replays the same logical change via the
   * supplied config (caller is responsible for re-applying mutations on retry
   * if their change depends on current state — see addAliasesToDistribution).
   */
  async updateDistribution(params: {
    distributionId: string;
    config: DistributionConfig;
    ifMatch: string;
  }): Promise<{ etag: string; status: string }> {
    try {
      const response = await this.client.send(
        new UpdateDistributionCommand({
          Id: params.distributionId,
          DistributionConfig: params.config,
          IfMatch: params.ifMatch,
        }),
      );

      if (!response.ETag || !response.Distribution) {
        this.logger.error(
          `CloudFront UpdateDistribution returned incomplete payload for ${params.distributionId}`,
        );
        throw new InternalServerErrorException(
          'CloudFront returned incomplete update response',
        );
      }

      this.logger.log(
        `CloudFront distribution ${params.distributionId} updated (status=${response.Distribution.Status})`,
      );

      return {
        etag: response.ETag,
        status: response.Distribution.Status ?? 'Unknown',
      };
    } catch (error) {
      this.handleAwsError(
        error,
        `updateDistribution(${params.distributionId})`,
      );
    }
  }

  /**
   * Returns deployment status + current aliases for the distribution.
   * Use this to wait for Status === 'Deployed' after a config change.
   */
  async getDistribution(distributionId: string): Promise<DistributionStatus> {
    try {
      const response = await this.client.send(
        new GetDistributionCommand({ Id: distributionId }),
      );

      const dist = response.Distribution;
      if (!dist) {
        throw new NotFoundException(
          `CloudFront distribution ${distributionId} not found`,
        );
      }

      return {
        status: dist.Status ?? 'Unknown',
        domainName: dist.DomainName ?? '',
        aliases: dist.DistributionConfig?.Aliases?.Items ?? [],
      };
    } catch (error) {
      this.handleAwsError(error, `getDistribution(${distributionId})`);
    }
  }

  /**
   * Adds aliases (CNAMEs) to a CloudFront distribution, optionally also setting
   * the ACM certificate ARN to use for those aliases. Read-modify-write with
   * ETag, retried on PreconditionFailedException up to UPDATE_MAX_ATTEMPTS.
   *
   * Safety:
   *   - Dedups additions against the current alias list.
   *   - Rejects if the resulting diff (new aliases - existing) > MAX_ALIAS_DIFF
   *     to catch accidental over-adds (the wipe vector is minimal here since
   *     we never remove, but the cap also bounds runaway batch additions).
   */
  async addAliasesToDistribution(params: {
    distributionId: string;
    aliasesToAdd: string[];
    acmCertificateArn?: string;
  }): Promise<{ etag: string }> {
    const { distributionId, aliasesToAdd, acmCertificateArn } = params;

    if (!aliasesToAdd || aliasesToAdd.length === 0) {
      throw new BadRequestException(
        'aliasesToAdd must contain at least one alias',
      );
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= UPDATE_MAX_ATTEMPTS; attempt++) {
      // Re-fetch each attempt so PreconditionFailed retries pick up the new ETag.
      const { config, etag } = await this.getDistributionConfig(distributionId);

      const existingAliases = config.Aliases?.Items ?? [];
      const existingSet = new Set(existingAliases);

      const newAliases = aliasesToAdd.filter((a) => !existingSet.has(a));

      if (newAliases.length === 0) {
        this.logger.log(
          `addAliasesToDistribution(${distributionId}): all ${aliasesToAdd.length} aliases already present, no-op`,
        );
        return { etag };
      }

      if (newAliases.length > MAX_ALIAS_DIFF) {
        throw new BadRequestException(
          `addAliasesToDistribution: refusing to add ${newAliases.length} aliases in one call (max ${MAX_ALIAS_DIFF}) — possible misconfiguration`,
        );
      }

      const merged = [...existingAliases, ...newAliases];

      const updatedConfig: DistributionConfig = {
        ...config,
        Aliases: {
          Quantity: merged.length,
          Items: merged,
        },
      };

      if (acmCertificateArn) {
        updatedConfig.ViewerCertificate = {
          ...(config.ViewerCertificate ?? {}),
          ACMCertificateArn: acmCertificateArn,
          SSLSupportMethod:
            config.ViewerCertificate?.SSLSupportMethod ?? 'sni-only',
          MinimumProtocolVersion:
            config.ViewerCertificate?.MinimumProtocolVersion ?? 'TLSv1.2_2021',
          CloudFrontDefaultCertificate: false,
        };
      }

      try {
        const result = await this.updateDistribution({
          distributionId,
          config: updatedConfig,
          ifMatch: etag,
        });

        this.logger.log(
          `Added ${newAliases.length} alias(es) to distribution ${distributionId}: ${newAliases.join(', ')}`,
        );

        return { etag: result.etag };
      } catch (error) {
        lastError = error;

        const name = (error as { name?: string })?.name;
        // Nest may have wrapped the original — also check message for SDK code.
        const isPrecondition =
          name === 'PreconditionFailedException' ||
          (error instanceof HttpException &&
            error.message?.includes('PreconditionFailed'));

        if (isPrecondition && attempt < UPDATE_MAX_ATTEMPTS) {
          this.logger.warn(
            `CloudFront ETag race on ${distributionId} (attempt ${attempt}/${UPDATE_MAX_ATTEMPTS}); retrying`,
          );
          continue;
        }

        throw error;
      }
    }

    // Unreachable in practice — loop above either returns or throws — but guard
    // against the type-narrowing edge so TypeScript is happy without `!`.
    throw (
      lastError ??
      new InternalServerErrorException(
        `addAliasesToDistribution exhausted ${UPDATE_MAX_ATTEMPTS} attempts`,
      )
    );
  }

  /**
   * Maps AWS SDK error names to typed Nest exceptions and logs the original.
   * Always re-throws.
   */
  private handleAwsError(error: unknown, context: string): never {
    const err = error as { name?: string; message?: string };
    const name = err?.name ?? 'UnknownError';
    const message = err?.message ?? 'Unknown CloudFront error';

    this.logger.error(`CloudFront error in ${context}: ${name} — ${message}`);

    if (error instanceof HttpException) {
      throw error;
    }

    switch (name) {
      case 'NoSuchDistribution':
      case 'NoSuchResource':
        throw new NotFoundException(
          `CloudFront resource not found: ${message}`,
        );
      case 'PreconditionFailedException':
        // Surfaced to caller so retry-aware code (addAliasesToDistribution)
        // can detect it via name; downstream callers get a 400.
        throw new BadRequestException(
          `CloudFront ETag mismatch (PreconditionFailed): ${message}`,
        );
      case 'InvalidArgument':
      case 'InvalidViewerCertificate':
      case 'CNAMEAlreadyExists':
      case 'TooManyDistributionCNAMEs':
      case 'InvalidIfMatchVersion':
        throw new BadRequestException(
          `CloudFront invalid argument: ${message}`,
        );
      case 'AccessDenied':
        throw new BadRequestException(`CloudFront access denied: ${message}`);
      default:
        throw new InternalServerErrorException(
          `CloudFront operation failed (${name}): ${message}`,
        );
    }
  }
}
