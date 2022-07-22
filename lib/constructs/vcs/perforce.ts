import * as fs from "fs";
import * as path from "path";
import { createSSMPolicy } from "../../utils";
import { Construct } from "constructs";
import { aws_autoscaling, aws_ec2, aws_iam, aws_s3, Tags } from "aws-cdk-lib";

export class P4PatternProps {
  readonly vpc: aws_ec2.IVpc;
  readonly allowAccessFrom: aws_ec2.IPeer[];
  readonly ssmLogBucket: aws_s3.IBucket;
  readonly subnetType: aws_ec2.SubnetType = aws_ec2.SubnetType.PUBLIC;
  // readonly hasReplica: boolean;  // WIP
  readonly isVanilla: boolean;
}

export class P4Pattern extends Construct {
  primaryInstance: aws_ec2.IInstance;

  constructor(scope: Construct, id: string, props: P4PatternProps) {
    super(scope, id);

    const p4SecurityGroup = new aws_ec2.SecurityGroup(this, "p4-sg", {
      vpc: props.vpc,
    });
    props.allowAccessFrom.forEach((p) => {
      p4SecurityGroup.addIngressRule(p, aws_ec2.Port.tcp(1666));
      p4SecurityGroup.addIngressRule(p, aws_ec2.Port.tcp(1999));
    });
    p4SecurityGroup.addIngressRule(
      aws_ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      aws_ec2.Port.tcp(1666)
    );
    p4SecurityGroup.addIngressRule(
      aws_ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      aws_ec2.Port.tcp(1999)
    );

    const p4Role = new aws_iam.Role(this, "p4-instance-role", {
      assumedBy: new aws_iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    p4Role.attachInlinePolicy(createSSMPolicy(this, props.ssmLogBucket));

    const userData = aws_ec2.UserData.custom(
      this.createUserData(props.isVanilla)
    );

    const instanceType = aws_ec2.InstanceType.of(
      aws_ec2.InstanceClass.C5,
      aws_ec2.InstanceSize.XLARGE
    );
    const machineImage = aws_ec2.MachineImage.latestAmazonLinux({
      generation: aws_ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
    });

    const p4PrimaryInstance = new aws_ec2.Instance(
      this,
      "p4-primary-instance",
      {
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
                volumeType: aws_autoscaling.EbsDeviceVolumeType.GP3,
              },
            },
          },
          {
            // for depot
            deviceName: "/dev/sdb",
            volume: {
              ebsDevice: {
                volumeSize: 500,
                volumeType: aws_autoscaling.EbsDeviceVolumeType.ST1,
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
                volumeType: aws_autoscaling.EbsDeviceVolumeType.GP3,
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
                volumeType: aws_autoscaling.EbsDeviceVolumeType.GP3,
                deleteOnTermination: false, // for a sudden termination
              },
            },
          },
        ],
      }
    );

    Tags.of(p4PrimaryInstance).add("Name", "PerforcePrimary");

    this.primaryInstance = p4PrimaryInstance;
  }

  createUserData(isVanilla: boolean): string {
    return `
      ${fs.readFileSync(
        path.join(__dirname, "perforce-primary-userdata.sh"),
        "utf8"
      )}
      ${
        isVanilla
          ? ""
          : fs.readFileSync(
              path.join(__dirname, "perforce-primary-add-sample-userdata.sh"),
              "utf8"
            )
      }    
    `;
  }
}
