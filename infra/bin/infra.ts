#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();
new InfraStack(app, 'TradeJournal-Dev', {
  env: { region: 'ap-southeast-2' },
});
