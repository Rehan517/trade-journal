import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

const fixtures = path.join(__dirname, 'fixtures');
const webDistPath = path.join(fixtures, 'web-dist');

// Use the same feature flags as `cdk synth` / `cdk deploy`, so the tests check
// the template that actually ships. Skip Lambda bundling to keep tests fast.
const cdkJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8'),
) as { context: Record<string, unknown> };

function newApp(): cdk.App {
  return new cdk.App({
    context: { ...cdkJson.context, 'aws:cdk:bundling-stacks': [] },
  });
}

type Statement = {
  Effect?: string;
  Action?: string | string[];
  Principal?: { Service?: string } | string;
  Resource?: unknown;
  Condition?: unknown;
};

const actionsOf = (s: Statement): string[] => [s.Action ?? []].flat();

function statementsOf(
  template: Template,
  type: 'AWS::S3::BucketPolicy' | 'AWS::IAM::Policy',
): Statement[] {
  return Object.values(template.findResources(type)).flatMap(
    (r) => r.Properties.PolicyDocument.Statement as Statement[],
  );
}

function logicalId(template: Template, type: string): string {
  const ids = Object.keys(template.findResources(type));
  expect(ids).toHaveLength(1);
  return ids[0]!;
}

describe('InfraStack web hosting', () => {
  const app = newApp();
  const stack = new InfraStack(app, 'TestStack', { webDistPath });
  const template = Template.fromStack(stack);
  const bucketId = logicalId(template, 'AWS::S3::Bucket');
  const distributionId = logicalId(template, 'AWS::CloudFront::Distribution');
  const bucketArn = { 'Fn::GetAtt': [bucketId, 'Arn'] };
  const bucketObjectsArn = {
    'Fn::Join': ['', [{ 'Fn::GetAtt': [bucketId, 'Arn'] }, '/*']],
  };

  test('bucket is private with no website hosting', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
    const bucket = template.findResources('AWS::S3::Bucket')[bucketId]!;
    expect(bucket.Properties).not.toHaveProperty('WebsiteConfiguration');
    expect(bucket.DeletionPolicy).toBe('Delete');
  });

  test('bucket auto-deletes objects (dev only)', () => {
    template.hasResourceProperties('Custom::S3AutoDeleteObjects', {
      BucketName: { Ref: bucketId },
    });
  });

  test('bucket policy lets only this distribution read objects', () => {
    const statements = statementsOf(template, 'AWS::S3::BucketPolicy');

    // Any Allow that grants a read (GetObject, Get*, s3:*, …) to anyone.
    const reads = statements.filter(
      (s) =>
        s.Effect === 'Allow' &&
        actionsOf(s).some((a) => /^s3:(\*|Get\*?|GetObject.*)$/.test(a)),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]).toEqual({
      Effect: 'Allow',
      Action: 's3:GetObject',
      Principal: { Service: 'cloudfront.amazonaws.com' },
      Resource: bucketObjectsArn,
      Condition: {
        StringEquals: {
          'AWS:SourceArn': {
            'Fn::Join': [
              '',
              expect.arrayContaining([
                ':distribution/',
                { Ref: distributionId },
              ]),
            ],
          },
        },
      },
    });

    // No listing, so missing keys come back as 403 (see the SPA fallback).
    expect(statements.flatMap(actionsOf)).not.toContain('s3:ListBucket');
  });

  test('bucket policy enforces SSL', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  test('distribution origin uses the OAC and no legacy OAI', () => {
    const oacId = logicalId(template, 'AWS::CloudFront::OriginAccessControl');
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
      }),
    });
    template.resourceCountIs(
      'AWS::CloudFront::CloudFrontOriginAccessIdentity',
      0,
    );
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: [
          Match.objectLike({
            DomainName: {
              'Fn::GetAtt': [bucketId, 'RegionalDomainName'],
            },
            OriginAccessControlId: { 'Fn::GetAtt': [oacId, 'Id'] },
            S3OriginConfig: { OriginAccessIdentity: '' },
          }),
        ],
      }),
    });
  });

  test('distribution redirects to https and falls back to index.html', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          // Managed CachingOptimized and SecurityHeadersPolicy ids.
          CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
          ResponseHeadersPolicyId: '67f7725c-6f97-4210-82d7-5512b31e9d03',
        }),
        CustomErrorResponses: Match.arrayEquals([
          {
            ErrorCode: 403,
            ResponsePagePath: '/index.html',
            ResponseCode: 200,
            ErrorCachingMinTTL: 0,
          },
          {
            ErrorCode: 404,
            ResponsePagePath: '/index.html',
            ResponseCode: 200,
            ErrorCachingMinTTL: 0,
          },
        ]),
      }),
    });
    const dist = template.findResources('AWS::CloudFront::Distribution')[
      distributionId
    ]!;
    // Default price class: all edge locations, including Australia.
    expect(dist.Properties.DistributionConfig).not.toHaveProperty('PriceClass');
  });

  test('exactly one bucket deployment, targeting the bucket and invalidating /*', () => {
    template.resourceCountIs('Custom::CDKBucketDeployment', 1);
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      DestinationBucketName: { Ref: bucketId },
      DistributionId: { Ref: distributionId },
      DistributionPaths: ['/*'],
      SystemMetadata: Match.objectLike({ 'cache-control': 'no-cache' }),
      Prune: true,
    });
  });

  test('deployment role writes only to the web bucket', () => {
    const statements = statementsOf(template, 'AWS::IAM::Policy');

    // Every statement that can write or delete objects is scoped to exactly
    // the web bucket and its objects.
    const writes = statements.filter((s) =>
      actionsOf(s).some((a) => /^s3:(\*|Put|Delete)/.test(a)),
    );
    expect(writes).toHaveLength(1);
    expect(actionsOf(writes[0]!)).toEqual(
      expect.arrayContaining(['s3:PutObject', 's3:DeleteObject*']),
    );
    expect(writes[0]!.Resource).toHaveLength(2);
    expect(writes[0]!.Resource).toEqual(
      expect.arrayContaining([bucketArn, bucketObjectsArn]),
    );

    // CDK grants invalidation on "*"; accepted, see the PR description.
    const invalidation = statements.filter((s) =>
      actionsOf(s).some((a) => a.startsWith('cloudfront:')),
    );
    expect(invalidation).toHaveLength(1);
    expect([...actionsOf(invalidation[0]!)].sort()).toEqual([
      'cloudfront:CreateInvalidation',
      'cloudfront:GetInvalidation',
    ]);
    expect(invalidation[0]!.Resource).toBe('*');
  });

  test('deployed build excludes a local config.json', () => {
    const assembly = app.synth();
    const assetDirs = fs
      .readdirSync(assembly.directory)
      .map((d) => path.join(assembly.directory, d))
      .filter(
        (d) =>
          path.basename(d).startsWith('asset.') &&
          fs.statSync(d).isDirectory() &&
          fs.existsSync(path.join(d, 'index.html')),
      );
    expect(assetDirs).toHaveLength(1);
    expect(fs.existsSync(path.join(assetDirs[0]!, 'config.json'))).toBe(false);
    // The fixture really does contain one, so the exclude is what removed it.
    expect(fs.existsSync(path.join(webDistPath, 'config.json'))).toBe(true);
  });

  test('outputs WebUrl and WebBucketName exist', () => {
    template.hasOutput('WebUrl', {
      Value: {
        'Fn::Join': [
          '',
          ['https://', { 'Fn::GetAtt': [distributionId, 'DomainName'] }],
        ],
      },
    });
    template.hasOutput('WebBucketName', { Value: { Ref: bucketId } });
  });

  test('Trades table is unchanged', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
    });
  });
});

describe('InfraStack web dist path', () => {
  test('throws a helpful error when the dist path is missing', () => {
    expect(
      () =>
        new InfraStack(newApp(), 'Missing', {
          webDistPath: path.join(fixtures, 'nope'),
        }),
    ).toThrow(/pnpm build/);
  });

  test('throws when the dist directory has no index.html', () => {
    expect(
      () => new InfraStack(newApp(), 'NoIndex', { webDistPath: fixtures }),
    ).toThrow(/pnpm build/);
  });
});
