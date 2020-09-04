import * as cdk from "@aws-cdk/core"
import { ServicePrincipal } from "@aws-cdk/aws-iam";
import { createSSMPolicy } from "../utils";
import * as ec2 from "@aws-cdk/aws-ec2"
import * as iam from "@aws-cdk/aws-iam"
import * as autoscaling from "@aws-cdk/aws-autoscaling"
import * as s3 from "@aws-cdk/aws-s3"

export class JenkinsPatternProps {
  readonly vpc: ec2.IVpc;
  readonly allowAccessFrom: ec2.IPeer[];

  readonly backupBucket: s3.IBucket;
  readonly ssmLoggingBucket: s3.IBucket;
}

export class JenkinsPattern extends cdk.Construct {
  readonly instance: ec2.Instance;

  constructor(scope: cdk.Construct, id: string, props: JenkinsPatternProps) {
    super(scope, id);

    const jenkinsSecurityGroup = new ec2.SecurityGroup(this, "jenkins-sg", {
      vpc: props.vpc,
    });

    props.allowAccessFrom.forEach((p) => {
      jenkinsSecurityGroup.addIngressRule(p, ec2.Port.tcp(80));
      jenkinsSecurityGroup.addIngressRule(p, ec2.Port.tcp(443));
    });
    // for build nodes
    jenkinsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(80)
    );
    jenkinsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(443)
    );
    jenkinsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(50000)
    );

    const jenkinsRole = new iam.Role(this, "jenkins-role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });
    jenkinsRole.attachInlinePolicy(
      createSSMPolicy(this, props.ssmLoggingBucket)
    );
    props.backupBucket.grantPut(jenkinsRole);

    /* eslint-disable no-useless-escape */
    const userData = ec2.UserData.custom(`
            #!/usr/bin/env bash

            set -eux

            sudo yum update -y
            sudo yum install -y python3 java-11-amazon-corretto-headless
            sudo pip3 install boto3
            
            # sudo yum install -y java-1.8.0-openjdk-devel.x86_64
            # sudo alternatives --install /usr/bin/java java /usr/lib/jvm/jre-1.8.0-openjdk.x86_64/bin/java 20000
            sudo alternatives --install /usr/bin/java java /usr/lib/jvm/java-11-amazon-corretto.x86_64/bin/java 20000
            sudo update-alternatives --auto java

            java -version

            sudo wget -O /etc/yum.repos.d/jenkins.repo https://pkg.jenkins.io/redhat/jenkins.repo
            sudo rpm --import https://pkg.jenkins.io/redhat/jenkins.io.key            

            sudo yum install -y jenkins
            rpm -qa | grep jenkins
            JENKINS_HOME="/var/lib/jenkins/"

            # make backup script
            cat << EOF | sudo tee /usr/local/backup-jenkins.sh
#!/usr/bin/env bash
set -eux

BACKUP_FILE="/tmp/jenkins-\\\$(date +"%Y-%m-%d-%H-%M-%S").tar"

# to avoid tar warning (file changed)
set +e
tar -cvf \\\${BACKUP_FILE} -C $JENKINS_HOME .
code=\\\$?
if [ \\\$code -ne 0 -a \\\$code -ne 1 ]; then
    echo "Fatal Error"
    exit \\\$code
fi
set -e

aws s3 cp \\\${BACKUP_FILE} s3://${props.backupBucket.bucketName}/jenkins-backup/
rm -rf \\\${BACKUP_FILE}
EOF
            sudo chmod 755 /usr/local/backup-jenkins.sh
            sudo chown jenkins:jenkins /usr/local/backup-jenkins.sh

            # to listen on 80 port
            sudo sed -ie 's/^JENKINS_PORT="8080"$/JENKINS_PORT="80"/' /etc/sysconfig/jenkins
            sudo sed -ie 's/^JENKINS_USER="jenkins"$/JENKINS_USER="root"/' /etc/sysconfig/jenkins

            sudo systemctl enable jenkins
            sudo systemctl start jenkins
        `);
    /* eslint-enable no-useless-escape */

    const instanceType = ec2.InstanceType.of(
      ec2.InstanceClass.M5,
      ec2.InstanceSize.XLARGE
    );
    const machineImage = ec2.MachineImage.latestAmazonLinux({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
    });
    const ebsSetting = {
      volumeSize: 30,
      volumeType: autoscaling.EbsDeviceVolumeType.GP2,
    };

    this.instance = new ec2.Instance(this, "jenkins-instance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
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
    cdk.Tags.of(this.instance).add("Name", "Jenkins");

    new ec2.CfnLaunchTemplate(this, "jenkins-template", {
      launchTemplateName: "jenkins-template",
      launchTemplateData: {
        instanceType: instanceType.toString(),
        imageId: machineImage.getImage(this).imageId,
        userData: cdk.Fn.base64(userData.render()),
        iamInstanceProfile: {
          arn: new iam.CfnInstanceProfile(this, "SVNInstanceProfile", {
            path: "/",
            roles: [jenkinsRole.roleName],
          }).attrArn,
        },
        blockDeviceMappings: [
          {
            deviceName: "/dev/sda1",
            ebs: ebsSetting,
          },
        ],
        securityGroupIds: [jenkinsSecurityGroup.securityGroupId],
        tagSpecifications: [
          {
            resourceType: "instance",
            tags: [
              {
                key: "Name",
                value: "Jenkins",
              },
            ],
          },
        ],
      },
    });
  }
}
