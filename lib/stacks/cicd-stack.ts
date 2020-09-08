import * as cdk from "@aws-cdk/core";
import * as s3 from "@aws-cdk/aws-s3";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as route53 from "@aws-cdk/aws-route53";
import { JenkinsPattern } from "../constructs/jenkins";

interface CICDStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  zone: route53.IPrivateHostedZone;
  recordName: string;
  backupBucket: s3.IBucket;
  allowAccessFrom: ec2.IPeer[];
  ssmLogBucket: s3.IBucket;
}

export class CICDStack extends cdk.Stack {
  readonly cicdEndpoint: string;
  readonly jenkinsInstance: ec2.IInstance;

  constructor(scope: cdk.Construct, id: string, props: CICDStackProps) {
    super(scope, id, props);

    const jenkins = new JenkinsPattern(this, "jenkins", {
      vpc: props.vpc,
      allowAccessFrom: props.allowAccessFrom,
      backupBucket: props.backupBucket,
      ssmLoggingBucket: props.ssmLogBucket,
    });
    this.jenkinsInstance = jenkins.instance;

    new route53.ARecord(this, "jenkins-ip", {
      zone: props.zone,
      recordName: props.recordName,
      target: route53.RecordTarget.fromIpAddresses(
        jenkins.instance.instancePrivateIp
      ),
    });
  }
}
