import { aws_ec2, aws_iam, aws_s3, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { createSSMPolicy } from "../utils";

interface BuildNodeImageStackProps extends StackProps {
  vpc: aws_ec2.IVpc;

  loggingBucket: aws_s3.IBucket;
  resourceBucket: aws_s3.IBucket;
  allowAccessFrom: aws_ec2.IPeer[];
  ssmLogBucket: aws_s3.IBucket;
}

export class BuildNodeImageStack extends Stack {
  readonly buildNodeInstanceProfile: aws_iam.CfnInstanceProfile;
  readonly buildNodeSecurityGroup: aws_ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: BuildNodeImageStackProps) {
    super(scope, id, props);

    // for launching from Jenkins
    const buildInstanceRole = new aws_iam.Role(this, "BuildInstanceRole", {
      assumedBy: new aws_iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    props.resourceBucket.grantPut(buildInstanceRole);
    buildInstanceRole.attachInlinePolicy(
      createSSMPolicy(this, props.ssmLogBucket)
    );
    // for automated launch
    buildInstanceRole.attachInlinePolicy(
      new aws_iam.Policy(this, "allow-tagging-policy", {
        statements: [
          new aws_iam.PolicyStatement({
            effect: aws_iam.Effect.ALLOW,
            resources: ["*"],
            actions: ["ec2:DeleteTags", "ec2:DescribeTags", "ec2:CreateTags"],
          }),
          new aws_iam.PolicyStatement({
            effect: aws_iam.Effect.ALLOW,
            resources: ["*"],
            actions: ["ec2:DescribeInstances"],
          }),
        ],
      })
    );
    this.buildNodeInstanceProfile = new aws_iam.CfnInstanceProfile(
      this,
      "BuildInstanceProfile",
      {
        path: "/",
        roles: [buildInstanceRole.roleName],
      }
    );

    const buildInstanceSG = new aws_ec2.SecurityGroup(this, "BuildInstanceSG", {
      vpc: props.vpc,
      securityGroupName: "BuildInstanceSG",
    });

    // for debugging
    props.allowAccessFrom.forEach((p) => {
      buildInstanceSG.addIngressRule(
        p,
        aws_ec2.Port.tcp(3389),
        "allow RDP access"
      );
    });
    buildInstanceSG.addIngressRule(
      aws_ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      aws_ec2.Port.tcp(50000)
    );
    this.buildNodeSecurityGroup = buildInstanceSG;
  }
}
