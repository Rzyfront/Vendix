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
  ACMClient,
  RequestCertificateCommand,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListCertificatesCommand,
  ListTagsForCertificateCommand,
  CertificateStatus,
  ValidationMethod,
} from '@aws-sdk/client-acm';

/**
 * Status values returned by ACM for a certificate.
 * Mirrors the AWS ACM CertificateStatus union for ergonomic consumption.
 */
export type AcmCertificateStatus =
  | 'PENDING_VALIDATION'
  | 'ISSUED'
  | 'INACTIVE'
  | 'EXPIRED'
  | 'VALIDATION_TIMED_OUT'
  | 'REVOKED'
  | 'FAILED';

export interface AcmDomainValidationOption {
  domainName: string;
  validationStatus: string;
  resourceRecord?: { name: string; type: string; value: string };
}

export interface AcmCertificateDescription {
  status: AcmCertificateStatus;
  domainValidationOptions: AcmDomainValidationOption[];
  notAfter?: Date;
}

export interface AcmTaggedCertificate {
  arn: string;
  domainName: string;
}

/**
 * Service responsible for interacting with AWS ACM (us-east-1, required by CloudFront).
 *
 * Auth: relies on the EC2 instance's IAM role — no explicit credentials are wired
 * here so deployments can rotate credentials transparently. Same pattern used by
 * S3Service for non-credentialed paths.
 */
@Injectable()
export class AcmService {
  private readonly logger = new Logger(AcmService.name);
  private readonly client: ACMClient;

  constructor(private readonly configService: ConfigService) {
    // CloudFront REQUIRES certs in us-east-1; the env override exists only for
    // local testing against alternative ACM endpoints (e.g. LocalStack).
    const region =
      this.configService.get<string>('AWS_ACM_REGION') || 'us-east-1';

    this.client = new ACMClient({ region });
  }

  /**
   * Requests a new public certificate from ACM with DNS validation.
   * Always tags the certificate with vendix:managed=true so the platform can
   * later identify and clean up its own resources via listCertificatesByTag.
   */
  async requestCertificate(params: {
    domainName: string;
    subjectAlternativeNames?: string[];
    idempotencyToken: string;
    tags?: Array<{ key: string; value: string }>;
  }): Promise<{ certificateArn: string }> {
    const tags = [
      { Key: 'vendix:managed', Value: 'true' },
      ...(params.tags ?? []).map((t) => ({ Key: t.key, Value: t.value })),
    ];

    try {
      const response = await this.client.send(
        new RequestCertificateCommand({
          DomainName: params.domainName,
          SubjectAlternativeNames: params.subjectAlternativeNames,
          ValidationMethod: ValidationMethod.DNS,
          IdempotencyToken: params.idempotencyToken,
          Tags: tags,
        }),
      );

      if (!response.CertificateArn) {
        this.logger.error(
          `ACM RequestCertificate returned no CertificateArn for ${params.domainName}`,
        );
        throw new InternalServerErrorException(
          'ACM did not return a certificate ARN',
        );
      }

      this.logger.log(
        `ACM certificate requested for ${params.domainName} -> ${response.CertificateArn}`,
      );

      return { certificateArn: response.CertificateArn };
    } catch (error) {
      this.handleAwsError(
        error,
        `requestCertificate(${params.domainName})`,
      );
    }
  }

  /**
   * Describes an ACM certificate, returning a normalized projection of the
   * fields the platform consumes (status + DNS validation records + expiry).
   */
  async describeCertificate(arn: string): Promise<AcmCertificateDescription> {
    try {
      const response = await this.client.send(
        new DescribeCertificateCommand({ CertificateArn: arn }),
      );

      const cert = response.Certificate;
      if (!cert) {
        this.logger.warn(`ACM DescribeCertificate returned empty for ${arn}`);
        throw new NotFoundException(`Certificate ${arn} not found`);
      }

      const status = (cert.Status ?? 'PENDING_VALIDATION') as AcmCertificateStatus;

      const domainValidationOptions: AcmDomainValidationOption[] = (
        cert.DomainValidationOptions ?? []
      ).map((opt) => ({
        domainName: opt.DomainName ?? '',
        validationStatus: opt.ValidationStatus ?? 'PENDING_VALIDATION',
        resourceRecord: opt.ResourceRecord
          ? {
              name: opt.ResourceRecord.Name ?? '',
              type: opt.ResourceRecord.Type ?? 'CNAME',
              value: opt.ResourceRecord.Value ?? '',
            }
          : undefined,
      }));

      return {
        status,
        domainValidationOptions,
        notAfter: cert.NotAfter,
      };
    } catch (error) {
      this.handleAwsError(error, `describeCertificate(${arn})`);
    }
  }

  /**
   * Deletes an ACM certificate. AWS will reject deletion if the certificate is
   * still associated with any AWS resource (e.g. CloudFront distribution).
   */
  async deleteCertificate(arn: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteCertificateCommand({ CertificateArn: arn }),
      );
      this.logger.log(`ACM certificate deleted: ${arn}`);
    } catch (error) {
      this.handleAwsError(error, `deleteCertificate(${arn})`);
    }
  }

  /**
   * Lists certificates owned by this account whose tags match the given key/value.
   * Iterates through all status buckets and pages, then issues a per-cert
   * ListTagsForCertificate to filter by tag (ACM has no server-side tag filter).
   */
  async listCertificatesByTag(
    tagKey: string,
    tagValue: string,
  ): Promise<AcmTaggedCertificate[]> {
    const matches: AcmTaggedCertificate[] = [];

    try {
      // ACM ListCertificates supports filtering by status; we want every cert
      // we manage regardless of state, so iterate without statuses (AWS default
      // returns ISSUED + PENDING_VALIDATION, which is what we care about). For
      // a wider net, callers should invoke this with the relevant statuses.
      let nextToken: string | undefined;

      do {
        const page = await this.client.send(
          new ListCertificatesCommand({
            CertificateStatuses: [
              CertificateStatus.ISSUED,
              CertificateStatus.PENDING_VALIDATION,
              CertificateStatus.INACTIVE,
              CertificateStatus.EXPIRED,
              CertificateStatus.VALIDATION_TIMED_OUT,
              CertificateStatus.REVOKED,
              CertificateStatus.FAILED,
            ],
            NextToken: nextToken,
          }),
        );

        for (const summary of page.CertificateSummaryList ?? []) {
          if (!summary.CertificateArn) continue;

          let tagsResponse;
          try {
            tagsResponse = await this.client.send(
              new ListTagsForCertificateCommand({
                CertificateArn: summary.CertificateArn,
              }),
            );
          } catch (tagError) {
            this.logger.warn(
              `listCertificatesByTag: failed to list tags for ${summary.CertificateArn}: ${
                (tagError as Error).message
              }`,
            );
            continue;
          }

          const hasTag = (tagsResponse.Tags ?? []).some(
            (t) => t.Key === tagKey && t.Value === tagValue,
          );

          if (hasTag) {
            matches.push({
              arn: summary.CertificateArn,
              domainName: summary.DomainName ?? '',
            });
          }
        }

        nextToken = page.NextToken;
      } while (nextToken);

      return matches;
    } catch (error) {
      this.handleAwsError(
        error,
        `listCertificatesByTag(${tagKey}=${tagValue})`,
      );
    }
  }

  /**
   * Maps AWS SDK error names to typed Nest exceptions and logs the original.
   * Always re-throws — never swallows.
   */
  private handleAwsError(error: unknown, context: string): never {
    const err = error as { name?: string; message?: string };
    const name = err?.name ?? 'UnknownError';
    const message = err?.message ?? 'Unknown ACM error';

    this.logger.error(`ACM error in ${context}: ${name} — ${message}`);

    // Already a Nest HttpException — preserve it.
    if (error instanceof HttpException) {
      throw error;
    }

    switch (name) {
      case 'ResourceNotFoundException':
        throw new NotFoundException(`ACM resource not found: ${message}`);
      case 'LimitExceededException':
        throw new BadRequestException(`ACM limit exceeded: ${message}`);
      case 'InvalidParameterException':
      case 'InvalidDomainValidationOptionsException':
      case 'InvalidTagException':
        throw new BadRequestException(`ACM invalid parameter: ${message}`);
      case 'RequestInProgressException':
      case 'TooManyTagsException':
      case 'TagPolicyException':
        throw new BadRequestException(`ACM request rejected: ${message}`);
      default:
        throw new InternalServerErrorException(
          `ACM operation failed (${name}): ${message}`,
        );
    }
  }
}
