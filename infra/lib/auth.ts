import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';

/**
 * Cognito prefix domain. The random suffix keeps it unique across AWS without
 * putting the account ID in the login URL. Generated once; do not change.
 */
export const AUTH_DOMAIN_PREFIX = 'trade-journal-dev-5b3e523c';

export const LOCAL_WEB_URL = 'http://localhost:5173';

export interface AuthProps {
  /** Web origin, `https://<distribution domain>`, no trailing slash. */
  readonly webUrl: string;
}

/** Cognito user pool with managed login and a public app client for the SPA. */
export class Auth extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly domain: cognito.UserPoolDomain;
  /** `https://<prefix>.auth.<region>.amazoncognito.com`, no trailing slash. */
  public readonly authDomain: string;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    // Cognito matches redirect URLs exactly, including the trailing slash.
    const appUrls = [`${props.webUrl}/`, `${LOCAL_WEB_URL}/`];

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      // Can't be changed after creation (it would replace the pool), so set it
      // now: Me@x.com and me@x.com are the same user.
      signInCaseSensitive: false,
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OFF,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      // Trades are keyed by the user's sub; a replaced pool would orphan them.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: AUTH_DOMAIN_PREFIX },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      // Managed login signs in with the flows enabled on the client, so keep
      // SRP (plus refresh). Explicit, so Cognito's default ALLOW_CUSTOM_AUTH
      // is not enabled.
      authFlows: { userSrp: true },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
          clientCredentials: false,
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: appUrls,
        logoutUrls: appUrls,
      },
    });

    // Cognito's default look, so the login page is styled from the first deploy.
    const branding = new cognito.CfnManagedLoginBranding(this, 'Branding', {
      userPoolId: this.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    // Managed login branding needs the managed login domain to exist first.
    branding.node.addDependency(this.domain);

    this.authDomain = this.domain.baseUrl();
  }
}
