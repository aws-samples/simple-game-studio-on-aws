import * as cdk from "@aws-cdk/core";
import { Peer } from "@aws-cdk/aws-ec2";
import { ServicePrincipal } from "@aws-cdk/aws-iam";
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";
import { createSSMPolicy } from "../../utils";
import { BackupPattern } from "../backup";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as iam from "@aws-cdk/aws-iam";
import * as autoscaling from "@aws-cdk/aws-autoscaling";
import * as s3 from "@aws-cdk/aws-s3";

export class SVNPatternProps {
  readonly vpc: ec2.IVpc;
  readonly backup: BackupPattern;
  readonly ssmLogBucket: s3.IBucket;
  readonly allowAccessFrom: ec2.IPeer[];
  readonly subnetType: ec2.SubnetType = ec2.SubnetType.PUBLIC;
}

// super simple HTTP based SVN server
export class SVNPattern extends cdk.Construct {
  readonly instance: ec2.Instance;

  constructor(scope: cdk.Construct, id: string, props: SVNPatternProps) {
    super(scope, id);

    const svnSecurityGroup = new ec2.SecurityGroup(this, "svn-sg", {
      vpc: props.vpc,
    });
    props.allowAccessFrom.forEach((p) =>
      svnSecurityGroup.addIngressRule(p, ec2.Port.tcp(80))
    );
    svnSecurityGroup.addIngressRule(
      Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(80)
    );

    const svnRole = new iam.Role(this, "svn-instance-role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });
    svnRole.attachInlinePolicy(createSSMPolicy(this, props.ssmLogBucket));

    const svnSecret = new secretsmanager.Secret(this, "VCSSecret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "admin" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
    });
    svnSecret.grantRead(svnRole);

    const { region } = new cdk.ScopedAws(this);
    const userData = ec2.UserData.custom(`
#!/usr/bin/env bash

set -eux

sudo yum update -y
sudo yum install -y mod_dav_svn subversion jq

sudo cat <<EOF | sudo tee /etc/httpd/conf.d/subversion.conf
LoadModule dav_svn_module     modules/mod_dav_svn.so
LoadModule authz_svn_module   modules/mod_authz_svn.so
<Location /svn>
DAV svn
SVNParentPath /var/www/html/svn
AuthType Basic
AuthName "SVN Auth"
AuthUserFile /etc/svn-auth-users
Require valid-user
</Location>
EOF

sudo mkdir -p /var/www/html/svn
cd /var/www/html/svn
sudo svnadmin create testrepo
sudo chown -R apache.apache testrepo

PASSWORD=$(aws secretsmanager get-secret-value --secret-id ${svnSecret.secretArn} --region ${region} --query SecretString --output text | jq -r .password)
sudo htpasswd -cb /etc/svn-auth-users admin $PASSWORD

sudo systemctl enable httpd
sudo systemctl start httpd
        `);

    const instanceType = ec2.InstanceType.of(
      ec2.InstanceClass.C5,
      ec2.InstanceSize.XLARGE
    );
    const machineImage = ec2.MachineImage.latestAmazonLinux({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
    });
    const ebsSetting = {
      volumeSize: 300,
      volumeType: autoscaling.EbsDeviceVolumeType.GP3,
      deleteOnTermination: false, // for a sudden termination
    };

    this.instance = new ec2.Instance(this, "svn-instance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: props.subnetType },
      securityGroup: svnSecurityGroup,
      instanceType,
      machineImage,
      userData,
      role: svnRole,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: {
            ebsDevice: ebsSetting,
          },
        },
      ],
    });

    cdk.Tags.of(this.instance).add(
      props.backup.BackupTagKey,
      props.backup.BackupTagValue
    );

    new ec2.CfnLaunchTemplate(this, "svn-template", {
      launchTemplateName: "svn-template",
      launchTemplateData: {
        instanceType: instanceType.toString(),
        imageId: machineImage.getImage(this).imageId,
        userData: cdk.Fn.base64(userData.render()),
        iamInstanceProfile: {
          arn: new iam.CfnInstanceProfile(this, "SVNInstanceProfile", {
            path: "/",
            roles: [svnRole.roleName],
          }).attrArn,
        },
        blockDeviceMappings: [
          {
            deviceName: "/dev/sda1",
            ebs: ebsSetting,
          },
        ],
        securityGroupIds: [svnSecurityGroup.securityGroupId],
        tagSpecifications: [
          {
            resourceType: "instance",
            tags: [
              {
                key: props.backup.BackupTagKey,
                value: props.backup.BackupTagValue,
              },
            ],
          },
        ],
      },
    });
  }
}
