import { Construct } from "constructs";
import { SimpleADPattern } from "./simple-ad";
import { createSSMPolicy, setupFirefoxPowershell } from "../utils";
import { aws_ec2, aws_iam, aws_s3, Tags } from "aws-cdk-lib";
import { RegionInfo } from "aws-cdk-lib/region-info";

interface WorkstationProps {
  vpc: aws_ec2.IVpc;

  loggingBucket: aws_s3.IBucket;
  resourceBucket: aws_s3.IBucket;
  allowAccessFrom: aws_ec2.IPeer[];
  ssmLogBucket: aws_s3.IBucket;
  readonly instanceType: aws_ec2.InstanceType;
  readonly activeDirectory: SimpleADPattern;
}

export class WorkstationPattern extends Construct {
  constructor(scope: Construct, id: string, props: WorkstationProps) {
    super(scope, id);

    // for launching from Jenkins
    const workstationRole = new aws_iam.Role(this, "WorkstationRole", {
      assumedBy: new aws_iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    workstationRole.attachInlinePolicy(
      createSSMPolicy(this, props.ssmLogBucket)
    );
    workstationRole.attachInlinePolicy(
      new aws_iam.Policy(this, "for-nice-policy", {
        statements: [
          new aws_iam.PolicyStatement({
            effect: aws_iam.Effect.ALLOW,
            resources: RegionInfo.regions.map(
              (i) => `arn:aws:s3:::dcv-license.${i.name}/*`
            ),
            actions: ["s3:GetObject"],
          }),
        ],
      })
    );
    workstationRole.attachInlinePolicy(
      new aws_iam.Policy(this, "for-gpu-policy", {
        statements: [
          new aws_iam.PolicyStatement({
            effect: aws_iam.Effect.ALLOW,
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
      aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonSSMManagedInstanceCore"
      )
    );
    workstationRole.addManagedPolicy(
      aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonSSMDirectoryServiceAccess"
      )
    );

    props.resourceBucket.grantRead(workstationRole);

    const workstationSG = new aws_ec2.SecurityGroup(this, "WorkstationSG", {
      vpc: props.vpc,
      securityGroupName: "WorkstationSG",
    });
    props.allowAccessFrom.forEach((p) => {
      workstationSG.addIngressRule(
        p,
        aws_ec2.Port.tcp(3389),
        "allow RDP access"
      );
      workstationSG.addIngressRule(
        p,
        aws_ec2.Port.tcp(8443),
        "allow NICE DCV access"
      );
      workstationSG.addIngressRule(
        p,
        aws_ec2.Port.udp(8443),
        "allow NICE DCV QUIC access"
      );
    });
    // for FastBuild
    workstationSG.addIngressRule(
      aws_ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      aws_ec2.Port.tcp(445),
      "allow SMB access"
    );
    workstationSG.addIngressRule(
      aws_ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      aws_ec2.Port.tcp(31264),
      "allow FastBuild access"
    );

    const userData = aws_ec2.UserData.custom(`
        <powershell>
        ${setupFirefoxPowershell()}
        ${this.setupNiceDCV("Administrator")}
        ${this.setupFastBuild()}
        ${this.downloadGPUDriver()}
        </powershell>
        `);

    const workstationTemplate = new aws_ec2.LaunchTemplate(
      this,
      "workstation-template",
      {
        launchTemplateName: "workstation-template",
        instanceType: props.instanceType,
        machineImage: aws_ec2.MachineImage.latestWindows(
          aws_ec2.WindowsVersion.WINDOWS_SERVER_2019_JAPANESE_FULL_BASE
        ),
        userData,
        role: workstationRole,
        blockDevices: [
          {
            deviceName: "/dev/sda1",
            volume: {
              ebsDevice: {
                volumeSize: 300,
                volumeType: aws_ec2.EbsDeviceVolumeType.GP3,
                iops: 3000,
              },
            },
          },
        ],
        securityGroup: workstationSG,
      }
    );
    Tags.of(workstationTemplate).add("Name", "NICE DCV");
    Tags.of(workstationTemplate).add("Feature", "Join-AD");
    Tags.of(workstationTemplate).add("NICE DCV AD User", "");
  }

  setupNiceDCV(owner_name: string): string {
    return `
        $ff_url = "https://d1uj6qtbmh3dt5.cloudfront.net/2022.1/Servers/nice-dcv-server-x64-Release-2022.1-13067.msi"
        $wc = New-Object net.webclient
        $wc.Downloadfile($ff_url, "nice.msi")
        Start-Process -Wait -FilePath msiexec.exe -ArgumentList /i, nice.msi, /passive, /norestart, /l*v, nice_install_msi.log, ADDLOCAL=ALL, AUTOMATIC_SESSION_OWNER=${owner_name}

        New-PSDrive -PSProvider Registry -Name HKU -Root HKEY_USERS
        $quicpath = 'HKU:/S-1-5-18/Software/GSettings/com/nicesoftware/dcv/connectivity'
        New-Item -Path $quicpath -EV Err -EA SilentlyContinue
        New-ItemProperty -Path $quicpath -Name 'enable-quic-frontend' -Value 1 -PropertyType DWord -EV Err -EA SilentlyContinue
        `;
  }

  setupFastBuild(): string {
    return `
      New-LocalUser -Name fb -Password (ConvertTo-SecureString "ChangeME!" -AsPlainText -Force) -EV Err -EA SilentlyContinue

      $zipfile = "C:\\fastbuild.zip"
      $targetPath = "C:\\fastbuild"
      $sharedFolder = "C:\\fb_shared"

      Invoke-WebRequest -Uri "https://fastbuild.org/downloads/v1.06/FASTBuild-Windows-x64-v1.06.zip" -OutFile $zipfile
      Expand-Archive $zipfile -DestinationPath $targetPath

      New-Item $sharedFolder -ItemType Directory -ea 0
      New-SmbShare -Name shared -Path $sharedFolder -FullAccess Everyone
      $Env:FASTBUILD_BROKERAGE_PATH = "$sharedFolder"
      [System.Environment]::SetEnvironmentVariable("FASTBUILD_BROKERAGE_PATH","$sharedFolder")

      Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/brechtsanders/winlibs_mingw/releases/download/12.1.0-14.0.4-10.0.0-ucrt-r2/winlibs-x86_64-posix-seh-gcc-12.1.0-llvm-14.0.4-mingw-w64ucrt-10.0.0-r2.zip" -OutFile C:\\mingw.zip
      Expand-Archive C:\\mingw.zip -DestinationPath C:\\mingw
    `;
  }

  downloadGPUDriver(): string {
    return `
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
    `;
  }
}
