import * as cdk from "@aws-cdk/core";
import * as s3 from "@aws-cdk/aws-s3";
import * as ec2 from "@aws-cdk/aws-ec2";
import { SimpleADPattern } from "../constructs/simple-ad";
import { WorkstationPattern } from "../constructs/workstation";

interface WorkstationStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly loggingBucket: s3.IBucket;
  readonly resourceBucket: s3.IBucket;
  readonly allowAccessFrom: ec2.IPeer[];
  readonly ssmLogBucket: s3.IBucket;
  readonly instanceType: ec2.InstanceType;
  readonly activeDirectory: SimpleADPattern;
}

export class WorkstationStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: WorkstationStackProps) {
    super(scope, id, props);

    new WorkstationPattern(this, "workstation", props);
  }
}
