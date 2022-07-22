import { Construct } from "constructs";
import { SVNPattern } from "../constructs/vcs/svn";
import { P4Pattern } from "../constructs/vcs/perforce";
import { aws_ec2, aws_route53, aws_s3, Stack, StackProps } from "aws-cdk-lib";

interface VCSStackProps extends StackProps {
  vpc: aws_ec2.IVpc;
  zone: aws_route53.IPrivateHostedZone;
  recordName: string;
  allowAccessFrom: aws_ec2.IPeer[];
  ssmLogBucket: aws_s3.IBucket;
  isSVN: boolean;
}

export class VCSStack extends Stack {
  readonly vcsEndpoint: string;

  constructor(scope: Construct, id: string, props: VCSStackProps) {
    super(scope, id, props);

    if (props.isSVN) {
      // SVN
      const svn = new SVNPattern(this, "svn", {
        vpc: props.vpc,

        allowAccessFrom: props.allowAccessFrom,
        subnetType: aws_ec2.SubnetType.PUBLIC,
        ssmLogBucket: props.ssmLogBucket,
      });

      new aws_route53.ARecord(this, "vcs-ip", {
        zone: props.zone,
        recordName: props.recordName,
        target: aws_route53.RecordTarget.fromIpAddresses(
          svn.instance.instancePrivateIp
        ),
      });
    }

    // Perforce
    const p4 = new P4Pattern(this, "p4", {
      vpc: props.vpc,
      allowAccessFrom: props.allowAccessFrom,
      subnetType: aws_ec2.SubnetType.PUBLIC,
      ssmLogBucket: props.ssmLogBucket,
      // hasReplica: true, // WIP
      isVanilla: !!this.node.tryGetContext("vanilla"),
    });

    new aws_route53.ARecord(this, "p4-ip", {
      zone: props.zone,
      recordName: "p4",
      target: aws_route53.RecordTarget.fromIpAddresses(
        p4.primaryInstance.instancePrivateIp
      ),
    });
  }
}
