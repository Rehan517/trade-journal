import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { LOCAL_WEB_URL } from './auth';

const REPO_ROOT = path.join(__dirname, '..', '..');
const HANDLERS_DIR = path.join(REPO_ROOT, 'apps', 'api', 'src', 'handlers');

export interface ApiProps {
  /** Web origin, `https://<distribution domain>`, no trailing slash. */
  readonly webUrl: string;
  readonly userPool: cognito.IUserPool;
  readonly userPoolClient: cognito.IUserPoolClient;
  /** Trades table; has the `byOpenedAt` local secondary index. */
  readonly table: dynamodb.ITableV2;
}

/**
 * HTTP API with a Cognito JWT authorizer by default: public `/health`, `/me`,
 * and the trades routes, one Lambda each.
 */
export class Api extends Construct {
  public readonly httpApi: apigwv2.HttpApi;
  /** `https://<id>.execute-api.<region>.amazonaws.com`, no trailing slash. */
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    // Each function gets an explicit log group. With the
    // `useCdkManagedLogGroup` flag, CDK would otherwise create its own too.
    const makeFunction = (
      name: string,
      file: string,
      environment?: Record<string, string>,
    ) =>
      new nodejs.NodejsFunction(this, name, {
        entry: path.join(HANDLERS_DIR, file),
        environment,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        projectRoot: REPO_ROOT,
        depsLockFilePath: path.join(REPO_ROOT, 'pnpm-lock.yaml'),
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY, // dev only
        }),
        bundling: {
          // CommonJS: the source package is ESM, but a CJS bundle needs no
          // package.json "type" at runtime and exports `handler` as
          // `exports.handler`, which Lambda loads directly.
          format: nodejs.OutputFormat.CJS,
          target: 'node22',
        },
      });

    const healthFunction = makeFunction('HealthFunction', 'health.ts');
    const meFunction = makeFunction('MeFunction', 'me.ts');

    const tableEnv = { TABLE_NAME: props.table.tableName };
    const createTradeFunction = makeFunction(
      'CreateTradeFunction',
      'create-trade.ts',
      tableEnv,
    );
    const getTradeFunction = makeFunction(
      'GetTradeFunction',
      'get-trade.ts',
      tableEnv,
    );
    const listTradesFunction = makeFunction(
      'ListTradesFunction',
      'list-trades.ts',
      tableEnv,
    );
    const updateTradeFunction = makeFunction(
      'UpdateTradeFunction',
      'update-trade.ts',
      tableEnv,
    );
    const deleteTradeFunction = makeFunction(
      'DeleteTradeFunction',
      'delete-trade.ts',
      tableEnv,
    );

    // One action each, on exactly one resource. No grant* helpers: they add
    // Scan, BatchGetItem and more. Query on an index is authorized against
    // the index ARN, so the list role gets no table-level permission.
    createTradeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [props.table.tableArn],
      }),
    );
    getTradeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [props.table.tableArn],
      }),
    );
    listTradesFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${props.table.tableArn}/index/byOpenedAt`],
      }),
    );

    // Update reads the stored trade, then writes the patched one back.
    updateTradeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        resources: [props.table.tableArn],
      }),
    );
    deleteTradeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:DeleteItem'],
        resources: [props.table.tableArn],
      }),
    );

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'trade-journal-dev',
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [props.webUrl, LOCAL_WEB_URL],
        allowMethods: [
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.OPTIONS,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.POST,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: cdk.Duration.days(1),
      },
      defaultAuthorizer: new authorizers.HttpUserPoolAuthorizer(
        'CognitoAuthorizer',
        props.userPool,
        { userPoolClients: [props.userPoolClient] },
      ),
    });

    new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi: this.httpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: 10, burstLimit: 20 },
    });

    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        'HealthIntegration',
        healthFunction,
      ),
      authorizer: new apigwv2.HttpNoneAuthorizer(),
    });

    this.httpApi.addRoutes({
      path: '/me',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        'MeIntegration',
        meFunction,
      ),
    });

    this.httpApi.addRoutes({
      path: '/trades',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        'CreateTradeIntegration',
        createTradeFunction,
      ),
    });

    this.httpApi.addRoutes({
      path: '/trades/{id}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        'GetTradeIntegration',
        getTradeFunction,
      ),
    });

    this.httpApi.addRoutes({
      path: '/trades',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        'ListTradesIntegration',
        listTradesFunction,
      ),
    });

    this.httpApi.addRoutes({
      path: '/trades/{id}',
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration(
        'UpdateTradeIntegration',
        updateTradeFunction,
      ),
    });

    this.httpApi.addRoutes({
      path: '/trades/{id}',
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new integrations.HttpLambdaIntegration(
        'DeleteTradeIntegration',
        deleteTradeFunction,
      ),
    });

    this.apiUrl = this.httpApi.apiEndpoint;
  }
}
