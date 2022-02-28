import { aws_iam, aws_s3 } from "aws-cdk-lib";
import { Construct } from "constructs";

export const createSSMPolicy = (
  scope: Construct,
  ssmLogBucket: aws_s3.IBucket
): aws_iam.Policy =>
  new aws_iam.Policy(scope, "ssm-policy", {
    statements: [
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        resources: ["*"],
        actions: [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
          "ssm:UpdateInstanceInformation",
        ],
      }),
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        resources: [ssmLogBucket.bucketArn],
        actions: ["s3:PutObject"],
      }),
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        resources: ["*"],
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
        ],
      }),
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        resources: ["*"],
        actions: ["s3:GetEncryptionConfiguration"],
      }),
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
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
