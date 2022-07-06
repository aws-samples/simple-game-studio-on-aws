import { Construct } from "constructs";
import { createSSMPolicy } from "../../utils";
import {
  aws_autoscaling,
  aws_ec2,
  aws_iam,
  aws_s3,
  aws_secretsmanager,
  ScopedAws,
} from "aws-cdk-lib";

export class SVNPatternProps {
  readonly vpc: aws_ec2.IVpc;
  readonly ssmLogBucket: aws_s3.IBucket;
  readonly allowAccessFrom: aws_ec2.IPeer[];
  readonly subnetType: aws_ec2.SubnetType = aws_ec2.SubnetType.PUBLIC;
}

// super simple HTTP based SVN server
export class SVNPattern extends Construct {
  readonly instance: aws_ec2.Instance;

  constructor(scope: Construct, id: string, props: SVNPatternProps) {
    super(scope, id);

    const svnSecurityGroup = new aws_ec2.SecurityGroup(this, "svn-sg", {
      vpc: props.vpc,
    });
    props.allowAccessFrom.forEach((p) =>
      svnSecurityGroup.addIngressRule(p, aws_ec2.Port.tcp(80))
    );
    svnSecurityGroup.addIngressRule(
      aws_ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      aws_ec2.Port.tcp(80)
    );

    const svnRole = new aws_iam.Role(this, "svn-instance-role", {
      assumedBy: new aws_iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    svnRole.attachInlinePolicy(createSSMPolicy(this, props.ssmLogBucket));

    const svnSecret = new aws_secretsmanager.Secret(this, "VCSSecret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "admin" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
    });
    svnSecret.grantRead(svnRole);

    const { region } = new ScopedAws(this);
    const userData = aws_ec2.UserData.custom(`
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

    const instanceType = aws_ec2.InstanceType.of(
      aws_ec2.InstanceClass.C5,
      aws_ec2.InstanceSize.XLARGE
    );
    const machineImage = aws_ec2.MachineImage.latestAmazonLinux({
      generation: aws_ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
    });
    const ebsSetting = {
      volumeSize: 300,
      volumeType: aws_autoscaling.EbsDeviceVolumeType.GP3,
      deleteOnTermination: false, // for a sudden termination
    };

    this.instance = new aws_ec2.Instance(this, "svn-instance", {
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

    const svnTemplate = new aws_ec2.LaunchTemplate(this, "svn-template", {
      launchTemplateName: "svn-template",
      instanceType,
      machineImage,
      userData: userData,
      role: svnRole,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: {
            ebsDevice: ebsSetting,
          },
        },
      ],
      securityGroup: svnSecurityGroup,
    });
  }
}
