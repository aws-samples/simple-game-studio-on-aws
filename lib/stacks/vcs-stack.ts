import * as cdk from "@aws-cdk/core"
import * as s3 from "@aws-cdk/aws-s3"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as route53 from "@aws-cdk/aws-route53";
import { SVNPattern } from "../constructs/vcs/svn";
import { BackupPattern } from "../constructs/backup";

interface VCSStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  zone: route53.IPrivateHostedZone;
  recordName: string;
  backup: BackupPattern;
  allowAccessFrom: ec2.IPeer[];
  ssmLogBucket: s3.IBucket;
}

export class VCSStack extends cdk.Stack {
  readonly vcsEndpoint: string;

  constructor(scope: cdk.Construct, id: string, props: VCSStackProps) {
    super(scope, id, props);

    const svn = new SVNPattern(this, "svn", {
      vpc: props.vpc,
      backup: props.backup,

      allowAccessFrom: props.allowAccessFrom,
      subnetType: ec2.SubnetType.PUBLIC,
      ssmLogBucket: props.ssmLogBucket,
    });

    new route53.ARecord(this, "vcs-ip", {
      zone: props.zone,
      recordName: props.recordName,
      target: route53.RecordTarget.fromIpAddresses(
        svn.instance.instancePrivateIp
      ),
    });
  }
}
