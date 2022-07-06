import {
  aws_ec2,
  aws_iam,
  aws_route53,
  aws_s3,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { JenkinsPattern } from "../constructs/jenkins";

interface CICDStackProps extends StackProps {
  vpc: aws_ec2.IVpc;
  zone: aws_route53.IPrivateHostedZone;
  recordName: string;
  backupBucket: aws_s3.IBucket;
  ssmLogBucket: aws_s3.IBucket;
  resourceBucket: aws_s3.IBucket;
  buildNodeInstanceProfile: aws_iam.CfnInstanceProfile;
  buildNodeSecurityGroup: aws_ec2.ISecurityGroup;
}

export class CICDStack extends Stack {
  readonly cicdEndpoint: string;
  readonly jenkinsInstance: aws_ec2.IInstance;

  constructor(scope: Construct, id: string, props: CICDStackProps) {
    super(scope, id, props);

    const jenkins = new JenkinsPattern(this, "jenkins", {
      vpc: props.vpc,
      backupBucket: props.backupBucket,
      ssmLoggingBucket: props.ssmLogBucket,
      artifactBucket: props.resourceBucket,
      buildNodeInstanceProfile: props.buildNodeInstanceProfile,
      buildNodeSecurityGroup: props.buildNodeSecurityGroup,
      isVanilla: !!this.node.tryGetContext("vanilla"),
    });
    this.jenkinsInstance = jenkins.instance;

    new aws_route53.ARecord(this, "jenkins-ip", {
      zone: props.zone,
      recordName: props.recordName,
      target: aws_route53.RecordTarget.fromIpAddresses(
        jenkins.instance.instancePrivateIp
      ),
    });
  }
}
