import * as cdk from "@aws-cdk/core";
import * as iam from "@aws-cdk/aws-iam";
import * as s3 from "@aws-cdk/aws-s3";

export const createSSMPolicy = (
  scope: cdk.Construct,
  ssmLogBucket: s3.IBucket
): iam.Policy =>
  new iam.Policy(scope, "ssm-policy", {
    statements: [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
          "ssm:UpdateInstanceInformation",
        ],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [ssmLogBucket.bucketArn],
        actions: ["s3:PutObject"],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
        ],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: ["s3:GetEncryptionConfiguration"],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: ["kms:GenerateDataKey"],
      }),
    ],
  });

export const setupFirefoxPowershell = (): string =>
  `
$ff_url = "https://download.mozilla.org/?product=firefox-msi-latest-ssl&os=win64&lang=en-US"
$wc = New-Object net.webclient
$wc.Downloadfile($ff_url, "firefox.msi")
Start-Process -Wait -FilePath msiexec.exe -ArgumentList /i, firefox.msi, /passive, /norestart, /l*v, firefox_install_msi.log
`;
