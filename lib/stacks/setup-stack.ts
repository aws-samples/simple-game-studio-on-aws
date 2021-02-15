import * as cdk from "@aws-cdk/core";
import * as s3 from "@aws-cdk/aws-s3";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as route53 from "@aws-cdk/aws-route53";
import * as ssm from "@aws-cdk/aws-ssm";
import { BackupPattern } from "../constructs/backup";
import { SimpleADPattern } from "../constructs/simple-ad";

export class SetupStack extends cdk.Stack {
  readonly jenkinsBackupBucket: s3.IBucket;
  readonly gameDevOnAWSResourcesBucket: s3.IBucket;
  readonly gameDevOnAWSLoggingBucket: s3.IBucket;
  readonly ssmLoggingBucket: s3.IBucket;

  readonly vpc: ec2.IVpc;
  readonly zone: route53.IPrivateHostedZone;
  readonly ad: SimpleADPattern;
  readonly awsBackup: BackupPattern;

  constructor(scope: cdk.Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.jenkinsBackupBucket = new s3.Bucket(this, "jenkinsBackupBucket", {});
    this.gameDevOnAWSResourcesBucket = new s3.Bucket(
      this,
      "GameDevOnAWSResourcesBucket",
      {}
    );
    this.gameDevOnAWSLoggingBucket = new s3.Bucket(
      this,
      "GameDevOnAWSLoggingBucket",
      {}
    );
    this.ssmLoggingBucket = new s3.Bucket(this, "SSMLoggingBucket", {});

    this.vpc = new ec2.Vpc(this, "aws-game-stuio-vpc", {
      // in order to use internal DNS (private hostzone)
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    this.ad = new SimpleADPattern(this, "StudioAD", {
      vpc: this.vpc,
      name: "simple-ad.mycompany",
    });
    const dhcpOptions = new ec2.CfnDHCPOptions(this, "simple-ad-dhcp-options", {
      domainName: "simple-ad-dhcp-options",
      domainNameServers: this.ad.dnsIpAddresses,
    });
    new ec2.CfnVPCDHCPOptionsAssociation(this, "simplead-dhcp-association", {
      dhcpOptionsId: dhcpOptions.ref,
      vpcId: this.vpc.vpcId,
    });

    // SSM state manager association for Workstations
    new ssm.CfnAssociation(this, "setup-ad", {
      name: "AWS-JoinDirectoryServiceDomain",
      associationName: "JoinADForWorkstations",
      parameters: {
        directoryId: [this.ad.directoryId],
        directoryName: [this.ad.name],
        directoryOU: [this.ad.directoryOU],
        dnsIpAddresses: [this.ad.dnsIpAddresses.join(",")],
      },
      scheduleExpression: "cron(0 0/30 * * * ? *)",
      targets: [
        {
          key: "tag:Feature",
          values: ["value:Join-AD"],
        },
      ],
    });

    this.zone = new route53.PrivateHostedZone(this, "GameStuidoHostedZone", {
      zoneName: "gamestudio.aws.internal",
      vpc: this.vpc, // At least one VPC has to be added to a Private Hosted Zone.
    });

    this.awsBackup = new BackupPattern(this, "AWSBackup");
  }
}
