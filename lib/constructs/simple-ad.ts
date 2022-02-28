import {
  aws_directoryservice,
  aws_ec2,
  aws_secretsmanager,
  CfnOutput,
  Fn,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export class SimpleADPatternProps {
  readonly name: string;
  readonly vpc: aws_ec2.IVpc;
}

export class SimpleADPattern extends Construct {
  readonly name: string;
  readonly directoryOU: string;
  readonly directoryId: string;
  // If you need these values in other stacks
  readonly dnsAddressesExportIds: string[];
  // Caution: use this value only in the same stack!
  readonly dnsIpAddresses: string[];

  constructor(scope: Construct, id: string, props: SimpleADPatternProps) {
    super(scope, id);

    this.name = props.name;
    this.directoryOU = this.name
      .split(".")
      .map((e) => `DC=${e}`)
      .join(",");

    const adSecret = new aws_secretsmanager.Secret(this, "SimpleADSecret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "admin" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
    });

    const directory = new aws_directoryservice.CfnSimpleAD(this, "StudioAD", {
      name: this.name,
      password: adSecret.secretValueFromJson("password").toString(),
      size: "Small",
      vpcSettings: {
        vpcId: props.vpc.vpcId,
        subnetIds: props.vpc.privateSubnets.map((e) => e.subnetId),
      },
    });

    this.directoryId = directory.ref;

    // to address this issue: https://github.com/aws/aws-cdk/issues/12523
    this.dnsAddressesExportIds = ["StudioADDNS1", "StudioADDNS2"];
    [0, 1].map((i) => {
      new CfnOutput(this, this.dnsAddressesExportIds[i], {
        value: Fn.select(i, directory.attrDnsIpAddresses),
        exportName: this.dnsAddressesExportIds[i],
      });
    });
    this.dnsIpAddresses = directory.attrDnsIpAddresses;
  }
}
