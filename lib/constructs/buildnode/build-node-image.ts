import * as cdk from "@aws-cdk/core"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as iam from "@aws-cdk/aws-iam"
import * as s3 from "@aws-cdk/aws-s3"
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";
import { createSSMPolicy, setupFirefoxPowershell } from "../../utils";

export class BuildNodeImageProps {
  readonly vpc: ec2.IVpc;
  readonly allowAccessFrom: ec2.IPeer[];
  readonly instanceType: ec2.InstanceType;
  readonly ssmLoggingBucket: s3.IBucket;
  readonly resourcesBucket: s3.IBucket;
  readonly logBucket: s3.IBucket;
}

export class BuildNodeImagePattern extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: BuildNodeImageProps) {
    super(scope, id);

    const buildNodeUserSecret = new secretsmanager.Secret(this, "BuildNodeUserSecret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "buildnode" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
    });

    const userData = ec2.UserData.custom(
      this.userDataForBuildMachineImage(
        props.logBucket,
        buildNodeUserSecret
      )
    );

    const role = new iam.Role(this, "BuildMachine", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    role.attachInlinePolicy(createSSMPolicy(this, props.ssmLoggingBucket));
    props.logBucket.grantPut(role);
    props.resourcesBucket.grantRead(role);
    buildNodeUserSecret.grantRead(role);

    const mySecurityGroup = new ec2.SecurityGroup(this, "EC2AccessFromRDP", {
      vpc: props.vpc,
      description: "Allow RDP access to ec2 instances",
      allowAllOutbound: true,
    });
    props.allowAccessFrom.forEach((p) => {
      mySecurityGroup.addIngressRule(p, ec2.Port.tcp(3389), "allow RDP access");
    });

    new ec2.CfnLaunchTemplate(this, "build-machine-image-template", {
      launchTemplateName: "build-machine-image-template",
      launchTemplateData: {
        instanceType: props.instanceType.toString(),
        imageId: ec2.MachineImage.latestWindows(
          ec2.WindowsVersion.WINDOWS_SERVER_2019_JAPANESE_FULL_BASE
        ).getImage(this).imageId,
        userData: cdk.Fn.base64(userData.render()),
        iamInstanceProfile: {
          arn: new iam.CfnInstanceProfile(this, "WorkstationInstanceProfile", {
            path: "/",
            roles: [role.roleName],
          }).attrArn,
        },
        blockDeviceMappings: [
          {
            deviceName: "/dev/sda1",
            ebs: {
              volumeSize: 500,
              volumeType: ec2.EbsDeviceVolumeType.GP2,
            },
          },
        ],
        securityGroupIds: [mySecurityGroup.securityGroupId],
        placement: {
          tenancy: "dedicated",
        },
      },
    });
  }

  install7zip(): string {
    return `
        $ff_url = "https://www.7-zip.org/a/7z1900-x64.msi"
        $wc = New-Object net.webclient
        $output = "C:\\7zip.msi"        
        $wc.Downloadfile($ff_url, $output)
        $logFile = "C:\\7zip.log"
        Start-Process msiexec.exe -Wait -ArgumentList "/I $output /quiet /norestart /L*v $logFile"
        `;
  }

  installAmazonCorretto11(): string {
    return `
        $url = "https://d3pxv6yz143wms.cloudfront.net/11.0.3.7.1/amazon-corretto-11.0.3.7.1-1-windows-x64.msi"
        $output = "C:\\amazon-corretto.msi"
        (New-Object System.Net.WebClient).DownloadFile($url, $output)
        $logFile = "C:\\corretto.log"
        Start-Process msiexec.exe -Wait -ArgumentList "/I $output /quiet /norestart /L*v $logFile"
        
        [Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\\Program Files\\Amazon Corretto\\jdk11.0.3_7")
        [System.Environment]::SetEnvironmentVariable("PATH", $Env:Path + ";$($Env:JAVA_HOME)\\bin", "User")
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        `;
  }

  createUser(userSecret: secretsmanager.ISecret): string {
    return `
        $secrets = ((Get-SECSecretValue -SecretId '${userSecret.secretArn}').SecretString | ConvertFrom-Json)
        $userName = $secrets.username
        $password = $secrets.password

        $Password = ConvertTo-SecureString $password -AsPlainText -Force
        New-LocalUser $userName -Password $Password -FullName "full_user_name" -Description "Description of the account"
        Add-LocalGroupMember -Group "Administrators" -Member $userName
        `;
  }

  userDataForBuildMachineImage(
    bucket: s3.IBucket,
    userSecret: secretsmanager.ISecret
  ): string {
    return `
        <powershell>
        $ErrorActionPreference = "Stop"

        try {
          ${this.createUser(userSecret)}
          ${setupFirefoxPowershell()}
          ${this.install7zip()}

          New-Item -Path "C:\\init-complete.txt" -ItemType File
        } catch [Exception] {
          echo $_.Exception.Message > exception.txt
          $ts = Get-Date -UFormat %s -Millisecond 0
          $filePath = "errorlogs/{0}.txt" -f $ts
          $BucketName = "${bucket.bucketName}"
          Write-S3Object -BucketName $BucketName -File exception.txt -Key $filePath
        }
        </powershell>
        <persist>true</persist>
        `;
  }
}
