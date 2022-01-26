import * as cdk from "@aws-cdk/core";
import * as s3 from "@aws-cdk/aws-s3";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as iam from "@aws-cdk/aws-iam";
import { SimpleADPattern } from "./simple-ad";
import { createSSMPolicy, setupFirefoxPowershell } from "../utils";
import { RegionInfo } from "@aws-cdk/region-info";

interface WorkstationProps {
  vpc: ec2.IVpc;

  loggingBucket: s3.IBucket;
  resourceBucket: s3.IBucket;
  allowAccessFrom: ec2.IPeer[];
  ssmLogBucket: s3.IBucket;
  readonly instanceType: ec2.InstanceType;
  readonly activeDirectory: SimpleADPattern;
}

export class WorkstationPattern extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: WorkstationProps) {
    super(scope, id);

    // for launching from Jenkins
    const workstationRole = new iam.Role(this, "WorkstationRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    workstationRole.attachInlinePolicy(
      createSSMPolicy(this, props.ssmLogBucket)
    );
    workstationRole.attachInlinePolicy(
      new iam.Policy(this, "for-nice-policy", {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: RegionInfo.regions.map(
              (i) => `arn:aws:s3:::dcv-license.${i.name}/*`
            ),
            actions: ["s3:GetObject"],
          }),
        ],
      })
    );
    workstationRole.attachInlinePolicy(
      new iam.Policy(this, "for-gpu-policy", {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
              "arn:aws:s3:::nvidia-gaming/*",
              "arn:aws:s3:::nvidia-gaming",
              "arn:aws:s3:::ec2-windows-nvidia-drivers/*",
              "arn:aws:s3:::ec2-windows-nvidia-drivers",
            ],
            actions: ["s3:Get*", "s3:List*"],
          }),
        ],
      })
    );
    workstationRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );
    workstationRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonSSMDirectoryServiceAccess"
      )
    );

    props.resourceBucket.grantRead(workstationRole);

    const workstationSG = new ec2.SecurityGroup(this, "WorkstationSG", {
      vpc: props.vpc,
      securityGroupName: "WorkstationSG",
    });
    props.allowAccessFrom.forEach((p) => {
      workstationSG.addIngressRule(p, ec2.Port.tcp(3389), "allow RDP access");
      workstationSG.addIngressRule(
        p,
        ec2.Port.tcp(8443),
        "allow NICE DCV access"
      );
    });

    const userData = ec2.UserData.custom(`
        <powershell>
        ${setupFirefoxPowershell()}
        ${this.setupNiceDCV("Administrator")}  // for default session
        ${this.downloadGPUDriver()}
        </powershell>
        `);

    new ec2.CfnLaunchTemplate(this, "workstation-template", {
      launchTemplateName: "workstation-template",
      launchTemplateData: {
        instanceType: props.instanceType.toString(),
        imageId: ec2.MachineImage.latestWindows(
          ec2.WindowsVersion.WINDOWS_SERVER_2019_JAPANESE_FULL_BASE
        ).getImage(this).imageId,
        userData: cdk.Fn.base64(userData.render()),
        iamInstanceProfile: {
          arn: new iam.CfnInstanceProfile(this, "WorkstationInstanceProfile", {
            path: "/",
            roles: [workstationRole.roleName],
          }).attrArn,
        },
        blockDeviceMappings: [
          {
            deviceName: "/dev/sda1",
            ebs: {
              volumeSize: 500,
              volumeType: ec2.EbsDeviceVolumeType.GP3,
            },
          },
        ],
        securityGroupIds: [workstationSG.securityGroupId],
        tagSpecifications: [
          {
            resourceType: "instance",
            tags: [
              {
                key: "Name",
                value: "NICE DCV",
              },
              {
                key: "Feature",
                value: "Join-AD",
              },
              {
                key: "NICE DCV AD User",
                value: "",
              },
            ],
          },
        ],
      },
    });
  }

  setupNiceDCV(owner_name: string): string {
    return `
        $ff_url = "https://d1uj6qtbmh3dt5.cloudfront.net/2021.3/Servers/nice-dcv-server-x64-Release-2021.3-11591.msi"
        $wc = New-Object net.webclient
        $wc.Downloadfile($ff_url, "nice.msi")
        Start-Process -Wait -FilePath msiexec.exe -ArgumentList /i, nice.msi, /passive, /norestart, /l*v, nice_install_msi.log, ADDLOCAL=ALL, AUTOMATIC_SESSION_OWNER=${owner_name}
        `;
  }

  downloadGPUDriver(): string {
    return `
    $KeyPrefix = "g4/latest"
    $Bucket = "ec2-windows-nvidia-drivers"
    $LocalPath = "$home\\Desktop\\NVIDIA"
    $Objects = Get-S3Object -BucketName $Bucket -KeyPrefix $KeyPrefix -Region us-east-1
    foreach ($Object in $Objects) {
        $LocalFileName = $Object.Key
        if ($LocalFileName -ne '' -and $Object.Size -ne 0) {
            $LocalFilePath = Join-Path $LocalPath $LocalFileName
            Copy-S3Object -BucketName $Bucket -Key $Object.Key -LocalFile $LocalFilePath -Region us-east-1
        }
    }

    $Bucket = "ec2-windows-nvidia-drivers"
    $KeyPrefix = "latest"
    $LocalPath = "$home\\Desktop\\NVIDIA"
    $Objects = Get-S3Object -BucketName $Bucket -KeyPrefix $KeyPrefix -Region us-east-1
    foreach ($Object in $Objects) {
        $LocalFileName = $Object.Key
        if ($LocalFileName -ne '' -and $Object.Size -ne 0) {
            $LocalFilePath = Join-Path $LocalPath $LocalFileName
            Copy-S3Object -BucketName $Bucket -Key $Object.Key -LocalFile $LocalFilePath -Region us-east-1
        }
    }

    $Bucket = "nvidia-gaming"
    $KeyPrefix = "windows/latest"
    $LocalPath = "$home\\Desktop\\NVIDIA"
    $Objects = Get-S3Object -BucketName $Bucket -KeyPrefix $KeyPrefix -Region us-east-1
    foreach ($Object in $Objects) {
        $LocalFileName = $Object.Key
        if ($LocalFileName -ne '' -and $Object.Size -ne 0) {
            $LocalFilePath = Join-Path $LocalPath $LocalFileName
            Copy-S3Object -BucketName $Bucket -Key $Object.Key -LocalFile $LocalFilePath -Region us-east-1
        }
    }    
    `;
  }
}
