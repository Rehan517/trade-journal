import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { WebHosting } from './web-hosting';

export interface InfraStackProps extends cdk.StackProps {
  /** Built web app. Defaults to apps/web/dist in the repo root. */
  readonly webDistPath?: string;
}

export const DEFAULT_WEB_DIST_PATH = path.resolve(__dirname, '..', '..', 'apps', 'web', 'dist');

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

    // Created last so later constructs can add sources (config.json).
    web.deploySite({ webDistPath });

    new cdk.CfnOutput(this, 'WebUrl', { value: web.url });
    new cdk.CfnOutput(this, 'WebBucketName', { value: web.bucket.bucketName });
  }
}
