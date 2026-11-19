import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

const webDistPath = path.join(__dirname, 'fixtures', 'web-dist');

// Same setup as infra.test.ts: real cdk.json feature flags, no Lambda bundling.
const cdkJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8'),
) as { context: Record<string, unknown> };

const app = new cdk.App({
  context: { ...cdkJson.context, 'aws:cdk:bundling-stacks': [] },
});
const stack = new InfraStack(app, 'AuthTestStack', { webDistPath });
const template = Template.fromStack(stack);

/** The single resource of a type: [logicalId, resource]. */
type Resource = {
  Properties: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  DependsOn?: string[];
};

const singletons = [
  'AWS::Cognito::UserPool',
  'AWS::Cognito::UserPoolClient',
  'AWS::Cognito::UserPoolDomain',
  'AWS::Cognito::ManagedLoginBranding',
  'AWS::CloudFront::Distribution',
  'Custom::CDKBucketDeployment',
];

// Looked up at load time without assertions; the count test below checks
// there is exactly one of each, so a failure shows up as a named test.
function first(type: string): [string, Resource] {
  const found = Object.entries(template.findResources(type));
  return (found[0] ?? ['<missing>', { Properties: {} }]) as [string, Resource];
}

const [poolId, pool] = first('AWS::Cognito::UserPool');
const [clientId, client] = first('AWS::Cognito::UserPoolClient');
const [domainId, domain] = first('AWS::Cognito::UserPoolDomain');
const [, branding] = first('AWS::Cognito::ManagedLoginBranding');
const [distributionId] = first('AWS::CloudFront::Distribution');

test('stack has exactly one of each auth-related resource', () => {
  for (const type of singletons) {
    expect([type, Object.keys(template.findResources(type)).length]).toEqual([
      type,
      1,
    ]);
  }
});

describe('Auth user pool', () => {
  test('admin-created users only, email sign-in, email verified', () => {
    expect(pool.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly).toBe(
      true,
    );
    expect(pool.Properties.UsernameAttributes).toEqual(['email']);
    expect(pool.Properties.AutoVerifiedAttributes).toEqual(['email']);
  });

  test('sign-in is case-insensitive (fixed at creation)', () => {
    expect(pool.Properties.UsernameConfiguration).toEqual({
      CaseSensitive: false,
    });
  });

  test('recovery by email only, MFA off, Essentials plan', () => {
    expect(pool.Properties.AccountRecoverySetting).toEqual({
      RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }],
    });
    expect(pool.Properties.MfaConfiguration).toBe('OFF');
    expect(pool.Properties.UserPoolTier).toBe('ESSENTIALS');
  });

  test('is retained, never deleted or replaced away', () => {
    expect(pool.DeletionPolicy).toBe('Retain');
    expect(pool.UpdateReplacePolicy).toBe('Retain');
  });
});

describe('Auth app client', () => {
  const webCallback = {
    'Fn::Join': [
      '',
      ['https://', { 'Fn::GetAtt': [distributionId, 'DomainName'] }, '/'],
    ],
  };

  test('is public and belongs to the pool', () => {
    expect(client.Properties.GenerateSecret).not.toBe(true);
    expect(client.Properties.UserPoolId).toEqual({ Ref: poolId });
  });

  test('authorization code grant only', () => {
    expect(client.Properties.AllowedOAuthFlows).toEqual(['code']);
    expect(client.Properties.AllowedOAuthFlowsUserPoolClient).toBe(true);
  });

  test('only SRP and refresh auth flows (no custom auth)', () => {
    expect([...client.Properties.ExplicitAuthFlows].sort()).toEqual([
      'ALLOW_REFRESH_TOKEN_AUTH',
      'ALLOW_USER_SRP_AUTH',
    ]);
  });

  test('scopes are exactly openid and email', () => {
    expect([...client.Properties.AllowedOAuthScopes].sort()).toEqual([
      'email',
      'openid',
    ]);
  });

  test('Cognito is the only identity provider', () => {
    expect(client.Properties.SupportedIdentityProviders).toEqual(['COGNITO']);
  });

  test('callback and logout URLs are exactly the app root, with trailing slash', () => {
    for (const urls of [
      client.Properties.CallbackURLs,
      client.Properties.LogoutURLs,
    ]) {
      expect(urls).toHaveLength(2);
      expect(urls).toEqual(
        expect.arrayContaining([webCallback, 'http://localhost:5173/']),
      );
    }
  });

  test('hides whether a user exists, default token lifetimes', () => {
    expect(client.Properties.PreventUserExistenceErrors).toBe('ENABLED');
    for (const key of [
      'AccessTokenValidity',
      'IdTokenValidity',
      'RefreshTokenValidity',
    ]) {
      expect(client.Properties).not.toHaveProperty(key);
    }
  });
});

describe('Auth domain and branding', () => {
  test('prefix domain uses the newer managed login', () => {
    expect(domain.Properties.Domain).toBe('trade-journal-dev-5b3e523c');
    expect(domain.Properties.ManagedLoginVersion).toBe(2);
    expect(domain.Properties.UserPoolId).toEqual({ Ref: poolId });
  });

  test('managed login branding uses Cognito-provided values for the client', () => {
    expect(branding.Properties.UserPoolId).toEqual({ Ref: poolId });
    expect(branding.Properties.ClientId).toEqual({ Ref: clientId });
    expect(branding.Properties.UseCognitoProvidedValues).toBe(true);
  });

  test('branding is created after the domain', () => {
    expect(branding.DependsOn).toContain(domainId);
  });
});

describe('config.json deployment', () => {
  const [, deployment] = first('Custom::CDKBucketDeployment');

  test('still exactly one bucket deployment', () => {
    template.resourceCountIs('Custom::CDKBucketDeployment', 1);
  });

  test('config.json source references the region, pool, client and domain', () => {
    const markers = deployment.Properties.SourceMarkers as Record<
      string,
      unknown
    >[];
    const configMarkers = markers.filter((m) => Object.keys(m).length > 0);
    expect(configMarkers).toHaveLength(1);
    const values = Object.values(configMarkers[0]!);
    expect(values).toEqual(
      expect.arrayContaining([
        { Ref: poolId },
        { Ref: clientId },
        { Ref: domainId },
        { Ref: 'AWS::Region' },
      ]),
    );
  });

  test('config.json has exactly the five keys, in the right places', () => {
    const markers = (
      deployment.Properties.SourceMarkers as Record<string, unknown>[]
    ).find((m) => Object.keys(m).length > 0)!;
    const markerFor = (value: unknown): string => {
      const hits = Object.entries(markers).filter(
        ([, v]) => JSON.stringify(v) === JSON.stringify(value),
      );
      expect(hits.length).toBeGreaterThan(0);
      return hits[0]![0];
    };

    // Find the asset directory holding the generated config.json.
    const assembly = app.synth();
    const configFiles = fs
      .readdirSync(assembly.directory)
      .map((d) => path.join(assembly.directory, d, 'config.json'))
      .filter((f) => fs.existsSync(f));
    expect(configFiles).toHaveLength(1);
    const body = fs.readFileSync(configFiles[0]!, 'utf8');
    const config = JSON.parse(body) as Record<string, string>;

    expect(Object.keys(config).sort()).toEqual([
      'apiUrl',
      'authDomain',
      'region',
      'userPoolClientId',
      'userPoolId',
    ]);
    expect(config.userPoolId).toBe(markerFor({ Ref: poolId }));
    expect(config.userPoolClientId).toBe(markerFor({ Ref: clientId }));
    expect(config.region).toBe(markerFor({ Ref: 'AWS::Region' }));
    expect(config.authDomain).toMatch(
      /^https:\/\/.*\.auth\..*\.amazoncognito\.com$/,
    );
    expect(config.authDomain).toContain(markerFor({ Ref: domainId }));
    expect(config.authDomain.endsWith('/')).toBe(false);
  });
});

describe('Auth outputs', () => {
  test('UserPoolId, UserPoolClientId and AuthDomain exist', () => {
    template.hasOutput('UserPoolId', { Value: { Ref: poolId } });
    template.hasOutput('UserPoolClientId', { Value: { Ref: clientId } });
    template.hasOutput('AuthDomain', {
      Value: {
        'Fn::Join': [
          '',
          [
            'https://',
            { Ref: domainId },
            '.auth.',
            { Ref: 'AWS::Region' },
            '.amazoncognito.com',
          ],
        ],
      },
    });
  });
});
