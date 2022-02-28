import { aws_ec2, aws_s3, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { SimpleADPattern } from "../constructs/simple-ad";
import { WorkstationPattern } from "../constructs/workstation";

interface WorkstationStackProps extends StackProps {
  readonly vpc: aws_ec2.IVpc;
  readonly loggingBucket: aws_s3.IBucket;
  readonly resourceBucket: aws_s3.IBucket;
  readonly allowAccessFrom: aws_ec2.IPeer[];
  readonly ssmLogBucket: aws_s3.IBucket;
  readonly instanceType: aws_ec2.InstanceType;
  readonly activeDirectory: SimpleADPattern;
}

export class WorkstationStack extends Stack {
  constructor(scope: Construct, id: string, props: WorkstationStackProps) {
    super(scope, id, props);

    new WorkstationPattern(this, "workstation", props);
  }
}
