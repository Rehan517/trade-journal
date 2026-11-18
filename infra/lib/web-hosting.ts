import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

export interface DeploySiteProps {
  /** Directory holding the built web app (must contain index.html). */
  readonly webDistPath: string;
  /** Extra sources for the same deployment, e.g. Source.jsonData('config.json', ...). */
  readonly additionalSources?: s3deploy.ISource[];
}

/** Private S3 bucket served through CloudFront with origin access control. */
export class WebHosting extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly url: string;
  private deployed = false;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // dev only
      autoDeleteObjects: true, // dev only
    });

    // SPA fallback: with OAC and no s3:ListBucket, a missing key returns 403.
    const spaFallback = (httpStatus: number): cloudfront.ErrorResponse => ({
      httpStatus,
      responsePagePath: '/index.html',
      responseHttpStatus: 200,
      ttl: cdk.Duration.seconds(0),
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket, {
          originAccessLevels: [cloudfront.AccessLevel.READ],
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      errorResponses: [spaFallback(403), spaFallback(404)],
    });

    this.url = `https://${this.distribution.distributionDomainName}`;
  }

  /**
   * Creates the single BucketDeployment for the bucket. Call it once, after
   * every source (such as config.json) is known.
   */
  public deploySite(props: DeploySiteProps): s3deploy.BucketDeployment {
    if (this.deployed) {
      throw new Error('deploySite() can only be called once: two deployments to one bucket would prune each other.');
    }
    this.deployed = true;

    return new s3deploy.BucketDeployment(this, 'SiteDeployment', {
      sources: [
        s3deploy.Source.asset(props.webDistPath, { exclude: ['config.json'] }),
        ...(props.additionalSources ?? []),
      ],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      cacheControl: [s3deploy.CacheControl.noCache()],
    });
  }
}
