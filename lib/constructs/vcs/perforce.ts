import * as fs from "fs";
import * as path from "path";
import * as cdk from "@aws-cdk/core";
import { Peer } from "@aws-cdk/aws-ec2";
import { ServicePrincipal } from "@aws-cdk/aws-iam";
import { createSSMPolicy } from "../../utils";
import { BackupPattern } from "../backup";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as iam from "@aws-cdk/aws-iam";
import * as autoscaling from "@aws-cdk/aws-autoscaling";
import * as s3 from "@aws-cdk/aws-s3";

export class P4PatternProps {
  readonly vpc: ec2.IVpc;
  readonly backup: BackupPattern;
  readonly allowAccessFrom: ec2.IPeer[];
  readonly ssmLogBucket: s3.IBucket;
  readonly subnetType: ec2.SubnetType = ec2.SubnetType.PUBLIC;
  // readonly hasReplica: boolean;  // WIP
}

export class P4Pattern extends cdk.Construct {
  primaryInstance: ec2.IInstance;

  constructor(scope: cdk.Construct, id: string, props: P4PatternProps) {
    super(scope, id);

    const p4SecurityGroup = new ec2.SecurityGroup(this, "p4-sg", {
      vpc: props.vpc,
    });
    props.allowAccessFrom.forEach((p) => {
      p4SecurityGroup.addIngressRule(p, ec2.Port.tcp(1666));
      p4SecurityGroup.addIngressRule(p, ec2.Port.tcp(1999));
    });
    p4SecurityGroup.addIngressRule(
      Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(1666)
    );
    p4SecurityGroup.addIngressRule(
      Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(1999)
    );

    const p4Role = new iam.Role(this, "p4-instance-role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });
    p4Role.attachInlinePolicy(createSSMPolicy(this, props.ssmLogBucket));

    const userData = ec2.UserData.custom(this.createUserData());

    const instanceType = ec2.InstanceType.of(
      ec2.InstanceClass.C5,
      ec2.InstanceSize.XLARGE
    );
    const machineImage = ec2.MachineImage.latestAmazonLinux({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
    });

    const p4PrimaryInstance = new ec2.Instance(this, "p4-primary-instance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: props.subnetType },
      securityGroup: p4SecurityGroup,
      instanceType,
      machineImage,
      userData,
      role: p4Role,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: {
            ebsDevice: {
              volumeSize: 8,
              volumeType: autoscaling.EbsDeviceVolumeType.GP3,
            },
          },
        },
        {
          // for depot
          deviceName: "/dev/sdb",
          volume: {
            ebsDevice: {
              volumeSize: 500,
              volumeType: autoscaling.EbsDeviceVolumeType.ST1,
              deleteOnTermination: false, // for a sudden termination
            },
          },
        },
        {
          // for metadata
          deviceName: "/dev/sdc",
          volume: {
            ebsDevice: {
              volumeSize: 64,
              volumeType: autoscaling.EbsDeviceVolumeType.GP3,
              deleteOnTermination: false, // for a sudden termination
            },
          },
        },
        {
          // for logs
          deviceName: "/dev/sdd",
          volume: {
            ebsDevice: {
              volumeSize: 128,
              volumeType: autoscaling.EbsDeviceVolumeType.GP3,
              deleteOnTermination: false, // for a sudden termination
            },
          },
        },
      ],
    });

    cdk.Tags.of(p4PrimaryInstance).add(
      props.backup.BackupTagKey,
      props.backup.BackupTagValue
    );
    cdk.Tags.of(p4PrimaryInstance).add("Name", "PerforcePrimary");

    this.primaryInstance = p4PrimaryInstance;
  }

  createUserData(): string {
    return fs.readFileSync(
      path.join(__dirname, "perforce-primary-userdata.sh"),
      "utf8"
    );
  }
}
