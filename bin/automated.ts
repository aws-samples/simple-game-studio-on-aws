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
  process.env.ALLOW_CIDR.split(",").forEach((cidr) => {
    internalNetwork.push(ec2.Peer.ipv4(cidr));
  });
}
if (process.env.ALLOW_PREFIX_LIST) {
  process.env.ALLOW_PREFIX_LIST.split(",").forEach((pl) => {
    internalNetwork.push(ec2.Peer.prefixList(pl));
  });
}

new VCSStack(app, "VCSStack", {
  vpc: setup.vpc,
  zone: setup.zone,
  recordName: "vcs",
  backup: setup.awsBackup,
  allowAccessFrom: internalNetwork,
  ssmLogBucket: setup.ssmLoggingBucket,
  isSVN: !!process.env.IS_SVN,
});

const bn = new BuildNodeImageStack(app, "BuildNodeImageStack", {
  vpc: setup.vpc,
  loggingBucket: setup.gameDevOnAWSLoggingBucket,
  resourceBucket: setup.gameDevOnAWSResourcesBucket,
  allowAccessFrom: internalNetwork,
  ssmLogBucket: setup.ssmLoggingBucket,
});

new CICDStack(app, "CICDStack", {
  vpc: setup.vpc,
  zone: setup.zone,
  recordName: "jenkins",
  backupBucket: setup.jenkinsBackupBucket,
  allowAccessFrom: internalNetwork,
  ssmLogBucket: setup.ssmLoggingBucket,
  resourceBucket: setup.gameDevOnAWSResourcesBucket,
  buildNodeInstanceProfile: bn.buildNodeInstanceProfile,
  buildNodeSecurityGroup: bn.buildNodeSecurityGroup,
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
  activeDirectory: setup.ad,
});
