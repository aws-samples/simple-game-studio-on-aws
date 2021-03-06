import * as cdk from "@aws-cdk/core";
import * as s3 from "@aws-cdk/aws-s3";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as iam from "@aws-cdk/aws-iam";
import { createSSMPolicy } from "../utils";

interface BuildNodeImageStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;

  loggingBucket: s3.IBucket;
  resourceBucket: s3.IBucket;
  allowAccessFrom: ec2.IPeer[];
  ssmLogBucket: s3.IBucket;
}

export class BuildNodeImageStack extends cdk.Stack {
  readonly buildNodeInstanceProfile: iam.CfnInstanceProfile;
  readonly buildNodeSecurityGroup: ec2.ISecurityGroup;

  constructor(
    scope: cdk.Construct,
    id: string,
    props: BuildNodeImageStackProps
  ) {
    super(scope, id, props);

    // for launching from Jenkins
    const buildInstanceRole = new iam.Role(this, "BuildInstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    props.resourceBucket.grantPut(buildInstanceRole);
    buildInstanceRole.attachInlinePolicy(
      createSSMPolicy(this, props.ssmLogBucket)
    );
    // for automated launch
    buildInstanceRole.attachInlinePolicy(
      new iam.Policy(this, "allow-tagging-policy", {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: ["*"],
            actions: ["ec2:DeleteTags", "ec2:DescribeTags", "ec2:CreateTags"],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: ["*"],
            actions: ["ec2:DescribeInstances"],
          }),
        ],
      })
    );
    this.buildNodeInstanceProfile = new iam.CfnInstanceProfile(
      this,
      "BuildInstanceProfile",
      {
        path: "/",
        roles: [buildInstanceRole.roleName],
      }
    );

    const buildInstanceSG = new ec2.SecurityGroup(this, "BuildInstanceSG", {
      vpc: props.vpc,
      securityGroupName: "BuildInstanceSG",
    });

    // for debugging
    props.allowAccessFrom.forEach((p) => {
      buildInstanceSG.addIngressRule(p, ec2.Port.tcp(3389), "allow RDP access");
    });
    buildInstanceSG.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(50000)
    );
    this.buildNodeSecurityGroup = buildInstanceSG;
  }
}
