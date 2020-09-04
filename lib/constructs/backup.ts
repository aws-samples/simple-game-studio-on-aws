import * as cdk from "@aws-cdk/core"
import * as iam from "@aws-cdk/aws-iam"
import { ServicePrincipal } from "@aws-cdk/aws-iam";
import * as backup from "@aws-cdk/aws-backup"
import * as kms from "@aws-cdk/aws-kms"

export class BackupPattern extends cdk.Construct {
  readonly BackupTagKey: string = "aws-backup";
  readonly BackupTagValue: string = "true";

  constructor(scope: cdk.Construct, id: string) {
    super(scope, id);

    // create service role by myself
    const backupRole = new iam.Role(scope, "backup-role", {
      assumedBy: new ServicePrincipal("backup.amazonaws.com"),
    });
    const EBSBackupPolicy = new iam.Policy(scope, "EBSBackupPolicy", {
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
          resources: ["arn:aws:ec2:*::snapshot/*", "arn:aws:ec2:*:*:volume/*"],
          actions: ["ec2:CreateSnapshot", "ec2:DeleteSnapshot"],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: ["*"],
          actions: ["ec2:DescribeVolumes", "ec2:DescribeSnapshots"],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          resources: ["*"],
          actions: ["tag:GetResources"],
        }),
      ],
    });
    backupRole.attachInlinePolicy(EBSBackupPolicy);

    const valutKey = new kms.Key(scope, "ValutDefaultKey", {
      enableKeyRotation: true,
      alias: "backup/default",
    });
    const valut = new backup.CfnBackupVault(scope, "backup-vault", {
      backupVaultName: "backup-vault",
      encryptionKeyArn: valutKey.keyArn,
    });
    const backupPlan = new backup.CfnBackupPlan(scope, "ebs-backup", {
      backupPlan: {
        backupPlanName: "ebs-backup",
        backupPlanRule: [
          {
            ruleName: "daily-10days-retention",
            targetBackupVault: valut.backupVaultName,
            scheduleExpression: "cron(0 12 * * ? *)",
            lifecycle: {
              deleteAfterDays: 10,
            },
          },
        ],
      },
    });
    backupPlan.addDependsOn(valut);

    new backup.CfnBackupSelection(scope, "ebs-backup-selection", {
      backupSelection: {
        iamRoleArn: backupRole.roleArn,
        selectionName: "ebs-by-tag",
        listOfTags: [
          {
            conditionType: "STRINGEQUALS",
            conditionKey: this.BackupTagKey,
            conditionValue: this.BackupTagValue,
          },
        ],
      },
      backupPlanId: backupPlan.attrBackupPlanId,
    });
  }
}
