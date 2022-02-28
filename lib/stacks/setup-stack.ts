import {
  aws_ec2,
  aws_route53,
  aws_s3,
  aws_ssm,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { BackupPattern } from "../constructs/backup";
import { SimpleADPattern } from "../constructs/simple-ad";

export class SetupStack extends Stack {
  readonly jenkinsBackupBucket: aws_s3.IBucket;
  readonly gameDevOnAWSResourcesBucket: aws_s3.IBucket;
  readonly gameDevOnAWSLoggingBucket: aws_s3.IBucket;
  readonly ssmLoggingBucket: aws_s3.IBucket;

  readonly vpc: aws_ec2.IVpc;
  readonly zone: aws_route53.IPrivateHostedZone;
  readonly ad: SimpleADPattern;
  readonly awsBackup: BackupPattern;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.jenkinsBackupBucket = new aws_s3.Bucket(
      this,
      "jenkinsBackupBucket",
      {}
    );
    this.gameDevOnAWSResourcesBucket = new aws_s3.Bucket(
      this,
      "GameDevOnAWSResourcesBucket",
      {}
    );
    this.gameDevOnAWSLoggingBucket = new aws_s3.Bucket(
      this,
      "GameDevOnAWSLoggingBucket",
      {}
    );
    this.ssmLoggingBucket = new aws_s3.Bucket(this, "SSMLoggingBucket", {});

    this.vpc = new aws_ec2.Vpc(this, "aws-game-stuio-vpc", {
      // in order to use internal DNS (private hostzone)
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    this.ad = new SimpleADPattern(this, "StudioAD", {
      vpc: this.vpc,
      name: "simple-ad.mycompany",
    });
    const dhcpOptions = new aws_ec2.CfnDHCPOptions(
      this,
      "simple-ad-dhcp-options",
      {
        domainName: "simple-ad-dhcp-options",
        domainNameServers: this.ad.dnsIpAddresses,
      }
    );
    new aws_ec2.CfnVPCDHCPOptionsAssociation(
      this,
      "simplead-dhcp-association",
      {
        dhcpOptionsId: dhcpOptions.ref,
        vpcId: this.vpc.vpcId,
      }
    );

    // SSM state manager association for Workstations
    new aws_ssm.CfnAssociation(this, "setup-ad", {
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

    this.zone = new aws_route53.PrivateHostedZone(
      this,
      "GameStuidoHostedZone",
      {
        zoneName: "gamestudio.aws.internal",
        vpc: this.vpc, // At least one VPC has to be added to a Private Hosted Zone.
      }
    );

    this.awsBackup = new BackupPattern(this, "AWSBackup");
  }
}
