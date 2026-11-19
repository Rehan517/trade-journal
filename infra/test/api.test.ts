import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

const webDistPath = path.join(__dirname, 'fixtures', 'web-dist');

// Same setup as auth.test.ts: real cdk.json feature flags, no Lambda bundling.
const cdkJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8'),
) as { context: Record<string, unknown> };

const app = new cdk.App({
  context: { ...cdkJson.context, 'aws:cdk:bundling-stacks': [] },
});
const stack = new InfraStack(app, 'ApiTestStack', { webDistPath });
const template = Template.fromStack(stack);

type Resource = {
  Properties: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

// Looked up without assertions at load time; the count test checks existence.
function all(type: string): [string, Resource][] {
  return Object.entries(template.findResources(type)) as [string, Resource][];
}
function first(type: string): [string, Resource] {
  return all(type)[0] ?? ['<missing>', { Properties: {} }];
}

const [apiId, api] = first('AWS::ApiGatewayV2::Api');
const [poolId] = first('AWS::Cognito::UserPool');
const [clientId] = first('AWS::Cognito::UserPoolClient');
const [distributionId] = first('AWS::CloudFront::Distribution');

const routes = all('AWS::ApiGatewayV2::Route');
const routeFor = (key: string) =>
  routes.find(([, r]) => r.Properties.RouteKey === key);
const functions = all('AWS::Lambda::Function').filter(([id]) =>
  /^Api(Health|Me)Function[0-9A-F]{8}$/.test(id),
);

test('stack has exactly one HTTP API, one stage, one authorizer and two routes', () => {
  expect(all('AWS::ApiGatewayV2::Api')).toHaveLength(1);
  expect(all('AWS::ApiGatewayV2::Stage')).toHaveLength(1);
  expect(all('AWS::ApiGatewayV2::Authorizer')).toHaveLength(1);
  expect(routes.map(([, r]) => r.Properties.RouteKey).sort()).toEqual([
    'GET /health',
    'GET /me',
  ]);
  expect(api.Properties.ProtocolType).toBe('HTTP');
});

describe('CORS', () => {
  const cors = () => api.Properties.CorsConfiguration;

  test('origins are exactly the distribution URL and localhost', () => {
    const origins = cors().AllowOrigins as unknown[];
    expect(origins).toHaveLength(2);
    expect(origins).toEqual(
      expect.arrayContaining([
        'http://localhost:5173',
        {
          'Fn::Join': [
            '',
            ['https://', { 'Fn::GetAtt': [distributionId, 'DomainName'] }],
          ],
        },
      ]),
    );
  });

  test('methods, headers and max age', () => {
    expect([...cors().AllowMethods].sort()).toEqual(['GET', 'OPTIONS']);
    expect([...cors().AllowHeaders].sort()).toEqual([
      'authorization',
      'content-type',
    ]);
    expect(cors().MaxAge).toBe(86400);
  });

  test('credentials are not allowed', () => {
    expect(cors().AllowCredentials).not.toBe(true);
  });
});

describe('routes and authorization', () => {
  test('GET /me uses a JWT authorizer for the pool and app client', () => {
    const route = routeFor('GET /me');
    expect(route?.[1].Properties.AuthorizationType).toBe('JWT');
    const authorizerId = route?.[1].Properties.AuthorizerId as {
      Ref: string;
    };
    const authorizer = all('AWS::ApiGatewayV2::Authorizer').find(
      ([id]) => id === authorizerId?.Ref,
    )?.[1];
    expect(authorizer?.Properties.AuthorizerType).toBe('JWT');
    expect(authorizer?.Properties.ApiId).toEqual({ Ref: apiId });
    expect(authorizer?.Properties.IdentitySource).toEqual([
      '$request.header.Authorization',
    ]);
    const jwt = authorizer?.Properties.JwtConfiguration;
    expect(jwt.Audience).toEqual([{ Ref: clientId }]);
    expect(jwt.Issuer).toEqual({
      'Fn::Join': [
        '',
        [
          'https://cognito-idp.',
          { Ref: 'AWS::Region' },
          '.amazonaws.com/',
          { Ref: poolId },
        ],
      ],
    });
  });

  test('GET /health is public', () => {
    const props = routeFor('GET /health')?.[1].Properties;
    expect(props?.AuthorizationType).toBe('NONE');
    expect(props?.AuthorizerId).toBeUndefined();
  });
});

describe('$default stage', () => {
  test('auto-deploys with throttling', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      ApiId: { Ref: apiId },
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: {
        ThrottlingRateLimit: 10,
        ThrottlingBurstLimit: 20,
      },
    });
  });
});

describe('Lambda functions', () => {
  test('there are exactly two handler functions', () => {
    expect(functions).toHaveLength(2);
  });

  test('both are arm64 on Node.js 22.x', () => {
    for (const [, f] of functions) {
      expect(f.Properties.Architectures).toEqual(['arm64']);
      expect(f.Properties.Runtime).toBe('nodejs22.x');
    }
  });

  test('roles only have basic execution, and no policies are attached', () => {
    const roleIds = functions.map(
      ([, f]) =>
        (f.Properties.Role as { 'Fn::GetAtt': string[] })['Fn::GetAtt'][0],
    );
    expect(new Set(roleIds).size).toBe(2);
    for (const roleId of roleIds) {
      const role = template.toJSON().Resources[roleId];
      expect(role.Properties.Policies).toBeUndefined();
      expect(role.Properties.ManagedPolicyArns).toHaveLength(1);
      expect(JSON.stringify(role.Properties.ManagedPolicyArns)).toContain(
        'service-role/AWSLambdaBasicExecutionRole',
      );
    }
    // No AWS::IAM::Policy (inline grant) is attached to either role.
    for (const [, policy] of all('AWS::IAM::Policy')) {
      const attached = JSON.stringify(policy.Properties.Roles);
      for (const roleId of roleIds) {
        expect(attached).not.toContain(`"${roleId}"`);
      }
    }
  });

  test('each function logs to its own explicit 30-day log group', () => {
    const groups = all('AWS::Logs::LogGroup').filter(([id]) =>
      id.startsWith('Api'),
    );
    expect(groups).toHaveLength(2);
    for (const [, g] of groups) {
      expect(g.Properties.RetentionInDays).toBe(30);
    }
    const referenced = functions.map(
      ([, f]) => f.Properties.LoggingConfig?.LogGroup,
    );
    expect(referenced).toHaveLength(2);
    expect(referenced).toEqual(
      expect.arrayContaining(groups.map(([id]) => ({ Ref: id }))),
    );
    // No log-retention custom resource alongside them.
    expect(all('Custom::LogRetention')).toHaveLength(0);
  });

  // Bundling is skipped in tests, so the CJS output format itself was checked
  // by hand in cdk.out (module.exports exposes `handler`).
  test('both use the index.handler entry point', () => {
    for (const [, f] of functions) {
      expect(f.Properties.Handler).toBe('index.handler');
    }
  });
});

describe('config.json and outputs', () => {
  test('config.json has apiUrl referencing the HTTP API', () => {
    const [, deployment] = first('Custom::CDKBucketDeployment');
    const markers = (
      deployment.Properties.SourceMarkers as Record<string, unknown>[]
    ).find((m) => Object.keys(m).length > 0)!;
    const apiRefs = Object.values(markers).filter((v) =>
      JSON.stringify(v).includes(`"${apiId}"`),
    );
    expect(apiRefs).toHaveLength(1);
    expect(apiRefs[0]).toEqual({ 'Fn::GetAtt': [apiId, 'ApiEndpoint'] });
  });

  test('ApiUrl output exists', () => {
    const outputs = template.toJSON().Outputs as Record<
      string,
      { Value: unknown }
    >;
    expect(outputs.ApiUrl).toBeDefined();
    expect(outputs.ApiUrl!.Value).toEqual({
      'Fn::GetAtt': [apiId, 'ApiEndpoint'],
    });
  });
});
