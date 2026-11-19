import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { WebHosting } from './web-hosting';
import { Auth } from './auth';

export interface InfraStackProps extends cdk.StackProps {
  /** Built web app. Defaults to apps/web/dist in the repo root. */
  readonly webDistPath?: string;
}

export const DEFAULT_WEB_DIST_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'apps',
  'web',
  'dist',
);

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InfraStackProps = {}) {
    const { webDistPath = DEFAULT_WEB_DIST_PATH, ...stackProps } = props;
    super(scope, id, stackProps);

    if (!fs.existsSync(path.join(webDistPath, 'index.html'))) {
      throw new Error(
        `Web build not found: expected ${path.join(webDistPath, 'index.html')}. Run \`pnpm build\` first.`,
      );
    }

    new dynamodb.TableV2(this, 'Trades', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY, // dev only
    });

    const web = new WebHosting(this, 'Web');

    const auth = new Auth(this, 'Auth', { webUrl: web.url });

    // Created last so later constructs can add sources (config.json).
    web.deploySite({
      webDistPath,
      additionalSources: [
        s3deploy.Source.jsonData('config.json', {
          region: this.region,
          userPoolId: auth.userPool.userPoolId,
          userPoolClientId: auth.userPoolClient.userPoolClientId,
          authDomain: auth.authDomain,
        }),
      ],
    });

    new cdk.CfnOutput(this, 'WebUrl', { value: web.url });
    new cdk.CfnOutput(this, 'WebBucketName', { value: web.bucket.bucketName });
    new cdk.CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: auth.userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, 'AuthDomain', { value: auth.authDomain });
  }
}
