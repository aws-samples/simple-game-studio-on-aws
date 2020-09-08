import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as directoryService from "@aws-cdk/aws-directoryservice";
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";

export class SimpleADPatternProps {
  readonly vpc: ec2.IVpc;
}

export class SimpleADPattern extends cdk.Construct {
  readonly directory: directoryService.CfnSimpleAD;

  constructor(scope: cdk.Construct, id: string, props: SimpleADPatternProps) {
    super(scope, id);

    const adSecret = new secretsmanager.Secret(this, "SimpleADSecret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "admin" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
    });

    this.directory = new directoryService.CfnSimpleAD(this, "StudioAD", {
      name: "studio-ad.mycompany",
      password: adSecret.secretValueFromJson("password").toString(),
      size: "Small",
      vpcSettings: {
        vpcId: props.vpc.vpcId,
        subnetIds: props.vpc.privateSubnets.map((e) => e.subnetId),
      },
    });
  }
}
