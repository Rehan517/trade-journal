import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { WebHosting } from './web-hosting';
import { Auth } from './auth';
import { Api } from './api';

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

    // The id is 'TradesTable', not 'Trades', on purpose. An LSI can only be
    // added when a table is created, and CloudFormation updates a GlobalTable
    // in place (DynamoDB rejects that). A new logical ID makes it create a new
    // table and delete the old one. Renaming again replaces the table and
    // deletes its data.
    const tradesTable = new dynamodb.TableV2(this, 'TradesTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY, // dev only
      // An LSI can only be added at table creation; strongly consistent list.
      localSecondaryIndexes: [
        {
          indexName: 'byOpenedAt',
          sortKey: { name: 'openedAtKey', type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.ALL,
        },
      ],
    });

    // Per-user symbol point values. Keys only, no indexes.
    const symbolsTable = new dynamodb.TableV2(this, 'SymbolsTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY, // dev only
    });

    const web = new WebHosting(this, 'Web');

    const auth = new Auth(this, 'Auth', { webUrl: web.url });

    const api = new Api(this, 'Api', {
      webUrl: web.url,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      table: tradesTable,
      symbolsTable,
    });

    // Created last so later constructs can add sources (config.json).
    web.deploySite({
      webDistPath,
      additionalSources: [
        s3deploy.Source.jsonData('config.json', {
          region: this.region,
          userPoolId: auth.userPool.userPoolId,
          userPoolClientId: auth.userPoolClient.userPoolClientId,
          authDomain: auth.authDomain,
          apiUrl: api.apiUrl,
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
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiUrl });
  }
}
