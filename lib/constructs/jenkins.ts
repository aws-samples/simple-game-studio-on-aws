import {
  aws_autoscaling,
  aws_ec2,
  aws_iam,
  aws_s3,
  ScopedAws,
  Tags,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { createSSMPolicy } from "../utils";

export class JenkinsPatternProps {
  readonly vpc: aws_ec2.IVpc;
  readonly allowAccessFrom: aws_ec2.IPeer[];

  readonly backupBucket: aws_s3.IBucket;
  readonly ssmLoggingBucket: aws_s3.IBucket;
  readonly artifactBucket: aws_s3.IBucket;

  readonly buildNodeInstanceProfile: aws_iam.CfnInstanceProfile;
  readonly buildNodeSecurityGroup: aws_ec2.ISecurityGroup;
}

export class JenkinsPattern extends Construct {
  readonly instance: aws_ec2.Instance;

  constructor(scope: Construct, id: string, props: JenkinsPatternProps) {
    super(scope, id);

    const jenkinsSecurityGroup = new aws_ec2.SecurityGroup(this, "jenkins-sg", {
      vpc: props.vpc,
    });

    props.allowAccessFrom.forEach((p) => {
      jenkinsSecurityGroup.addIngressRule(p, aws_ec2.Port.tcp(80));
      jenkinsSecurityGroup.addIngressRule(p, aws_ec2.Port.tcp(443));
    });
    // for build nodes
    [80, 443, 50000].forEach((port) => {
      jenkinsSecurityGroup.addIngressRule(
        aws_ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
        aws_ec2.Port.tcp(port)
      );
    });

    const jenkinsRole = new aws_iam.Role(this, "jenkins-role", {
      assumedBy: new aws_iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    jenkinsRole.attachInlinePolicy(
      createSSMPolicy(this, props.ssmLoggingBucket)
    );
    props.backupBucket.grantReadWrite(jenkinsRole);

    // to launch instance from Jenkins
    jenkinsRole.attachInlinePolicy(
      new aws_iam.Policy(scope, "jenkins-ec2-policy", {
        statements: [
          new aws_iam.PolicyStatement({
            effect: aws_iam.Effect.ALLOW,
            resources: ["*"],
            actions: ["iam:ListInstanceProfilesForRole", "iam:PassRole"],
          }),
          new aws_iam.PolicyStatement({
            effect: aws_iam.Effect.ALLOW,
            resources: ["*"],
            actions: [
              "ec2:DescribeSpotInstanceRequests",
              "ec2:CancelSpotInstanceRequests",
              "ec2:GetConsoleOutput",
              "ec2:DescribeInstances",
              "ec2:DescribeKeyPairs",
              "ec2:DescribeRegions",
              "ec2:DescribeImages",
              "ec2:DescribeAvailabilityZones",
              "ec2:DescribeSecurityGroups",
              "ec2:DescribeSubnets",
              "ec2:GetPasswordData",
            ],
          }),
          new aws_iam.PolicyStatement({
            effect: aws_iam.Effect.ALLOW,
            resources: ["*"],
            actions: [
              "ec2:RequestSpotInstances",
              "ec2:RunInstances",
              "ec2:CreateTags",
              "ec2:DeleteTags",
            ],
          }),
          new aws_iam.PolicyStatement({
            effect: aws_iam.Effect.ALLOW,
            resources: ["*"],
            actions: [
              "ec2:StartInstances",
              "ec2:StopInstances",
              "ec2:TerminateInstances",
            ],
            conditions: {
              StringEquals: {
                "ec2:ResourceTag/Purpose": "buildnode",
              },
            },
          }),
        ],
      })
    );

    /* eslint-disable no-useless-escape */
    const userData = aws_ec2.UserData.custom(`
            #!/usr/bin/env bash

            set -eux

            sudo yum update -y
            sudo yum install -y python3 java-11-amazon-corretto-headless
            sudo pip3 install boto3
            
            sudo alternatives --install /usr/bin/java java /usr/lib/jvm/java-11-amazon-corretto.x86_64/bin/java 20000
            sudo update-alternatives --auto java

            java -version

            sudo amazon-linux-extras install epel -y
            sudo wget -O /etc/yum.repos.d/jenkins.repo https://pkg.jenkins.io/redhat-stable/jenkins.repo
            sudo rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io.key
            sudo yum upgrade -y

            sudo yum install -y jenkins
            rpm -qa | grep jenkins
            JENKINS_HOME="/var/lib/jenkins/"

            # make backup script
            cat << EOF | sudo tee /usr/local/backup-jenkins.sh
#!/usr/bin/env bash
set -eux

BACKUP_FILE="/tmp/jenkins-\\\$(date +"%Y-%m-%d-%H-%M-%S").tar.gz"

# to avoid tar warning (file changed)
set +e
tar -zcvf \\\${BACKUP_FILE} -C $JENKINS_HOME .
code=\\\$?
if [ \\\$code -ne 0 -a \\\$code -ne 1 ]; then
    echo "Fatal Error"
    exit \\\$code
fi
set -e

aws s3 cp \\\${BACKUP_FILE} s3://${
      props.backupBucket.bucketName
    }/jenkins-backup/
rm -rf \\\${BACKUP_FILE}
EOF
            sudo chmod 755 /usr/local/backup-jenkins.sh
            sudo chown jenkins:jenkins /usr/local/backup-jenkins.sh

            # environment settings for easy launching
            cat << EOF | sudo tee /usr/local/env-vars-for-launching-buildnode.sh
#!/usr/bin/env bash
export BN_SUBNET_ID=${props.vpc.publicSubnets[0].subnetId}
export BN_INSTANCE_PROFILE_ARN=${props.buildNodeInstanceProfile.attrArn}
export BN_SG_ID=${props.buildNodeSecurityGroup.securityGroupId}
export BN_REGION=${new ScopedAws(this).region}
export BUILD_ARTIFACT_BUCKET=${props.artifactBucket.bucketName}
EOF
            sudo chmod 755 /usr/local/env-vars-for-launching-buildnode.sh
            sudo chown jenkins:jenkins /usr/local/env-vars-for-launching-buildnode.sh

            # to listen on 80 port
            sudo sed -ie 's/^JENKINS_PORT="8080"$/JENKINS_PORT="80"/' /etc/sysconfig/jenkins
            sudo sed -ie 's/^JENKINS_USER="jenkins"$/JENKINS_USER="root"/' /etc/sysconfig/jenkins

            sudo systemctl enable jenkins
            sudo systemctl start jenkins
        `);
    /* eslint-enable no-useless-escape */

    const instanceType = aws_ec2.InstanceType.of(
      aws_ec2.InstanceClass.M5,
      aws_ec2.InstanceSize.XLARGE
    );
    const machineImage = aws_ec2.MachineImage.latestAmazonLinux({
      generation: aws_ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
    });
    const ebsSetting = {
      volumeSize: 30,
      volumeType: aws_autoscaling.EbsDeviceVolumeType.GP3,
    };

    this.instance = new aws_ec2.Instance(this, "jenkins-instance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: aws_ec2.SubnetType.PUBLIC },
      instanceType,
      machineImage,
      userData,
      role: jenkinsRole,
      securityGroup: jenkinsSecurityGroup,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: {
            ebsDevice: ebsSetting,
          },
        },
      ],
    });
    Tags.of(this.instance).add("Name", "Jenkins");

    const jenkinsTmplate = new aws_ec2.LaunchTemplate(
      this,
      "jenkins-template",
      {
        launchTemplateName: "jenkins-template",
        instanceType,
        machineImage,
        userData: userData,
        role: jenkinsRole,
        blockDevices: [
          {
            deviceName: "/dev/sda1",
            volume: {
              ebsDevice: ebsSetting,
            },
          },
        ],
        securityGroup: jenkinsSecurityGroup,
      }
    );
    Tags.of(jenkinsTmplate).add("Name", "Jenkins");
  }
}
