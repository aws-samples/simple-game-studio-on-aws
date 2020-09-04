#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import { SetupStack } from "../lib/stacks/setup-stack";
import { VCSStack } from "../lib/stacks/vcs-stack";
import { CICDStack } from "../lib/stacks/cicd-stack";
import { BuildNodeImageStack } from "../lib/stacks/buildnode-image-stack";
import { WorkstationStack } from "../lib/stacks/workstation-stack";

const app = new cdk.App();

const setup = new SetupStack(app, "SetupStack", {});

const internalNetwork: ec2.IPeer[] = [];
if (process.env.ALLOW_CIDR) {
  internalNetwork.push(ec2.Peer.ipv4(process.env.ALLOW_CIDR));
}
if (process.env.ALLOW_PREFIX_LIST) {
  internalNetwork.push(ec2.Peer.prefixList(process.env.ALLOW_PREFIX_LIST));
}

new VCSStack(app, "VCSStack", {
  vpc: setup.vpc,
  zone: setup.zone,
  recordName: "vcs",
  backup: setup.awsBackup,
  allowAccessFrom: internalNetwork,
  ssmLogBucket: setup.ssmLoggingBucket,
});

const jenkins = new CICDStack(app, "CICDStack", {
  vpc: setup.vpc,
  zone: setup.zone,
  recordName: "jenkins",
  backupBucket: setup.jenkinsBackupBucket,
  allowAccessFrom: internalNetwork,
  ssmLogBucket: setup.ssmLoggingBucket,
});

new BuildNodeImageStack(app, "BuildNodeImageStack", {
  vpc: setup.vpc,
  loggingBucket: setup.gameDevOnAWSLoggingBucket,
  resourceBucket: setup.gameDevOnAWSResourcesBucket,
  allowAccessFrom: internalNetwork,
  ssmLogBucket: setup.ssmLoggingBucket,
  jenkinsInstance: jenkins.jenkinsInstance,
});

new WorkstationStack(app, "WorkStationStack", {
  vpc: setup.vpc,
  loggingBucket: setup.gameDevOnAWSLoggingBucket,
  resourceBucket: setup.gameDevOnAWSResourcesBucket,
  allowAccessFrom: internalNetwork,
  ssmLogBucket: setup.ssmLoggingBucket,

  instanceType: ec2.InstanceType.of(
    ec2.InstanceClass.G4DN,
    ec2.InstanceSize.XLARGE
  ),
});
