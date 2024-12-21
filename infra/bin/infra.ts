#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { InfraStack } from "../lib/infra-stack";
import { ReferenceArchitectureIoTStack } from "../lib/cloud-reference-architecture-iot/reference-architecture-stack";

const app = new cdk.App();

new ReferenceArchitectureIoTStack(app, "IoTStack", {
  env: {
    account: process.env.ACCOUNT_ID,
    region: process.env.REGION,
  },
});
