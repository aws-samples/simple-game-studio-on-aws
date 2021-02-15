import * as cdk from "@aws-cdk/core";
import * as iam from "@aws-cdk/aws-iam";
import { ServicePrincipal } from "@aws-cdk/aws-iam";
import * as backup from "@aws-cdk/aws-backup";
import * as kms from "@aws-cdk/aws-kms";

export class BackupPattern extends cdk.Construct {
  readonly BackupTagKey: string = "aws-backup";
  readonly BackupTagValue: string = "true";

  constructor(scope: cdk.Construct, id: string) {
    super(scope, id);

    // create service role by myself
    const backupRole = new iam.Role(scope, "game-studio-backup-role", {
      assumedBy: new ServicePrincipal("backup.amazonaws.com"),
    });

    backupRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AWSBackupOperatorAccess")
    );
    backupRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSBackupServiceRolePolicyForBackup"
      )
    );

    const valutKey = new kms.Key(scope, "ValutDefaultKey", {
      enableKeyRotation: true,
      alias: "backup/default",
    });
    const valut = new backup.CfnBackupVault(scope, "game-studio-backup-vault", {
      backupVaultName: "game-studio-backup-vault",
      encryptionKeyArn: valutKey.keyArn,
    });
    const backupPlan = new backup.CfnBackupPlan(
      scope,
      "game-studio-ebs-backup",
      {
        backupPlan: {
          backupPlanName: "game-studio-ebs-backup",
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
      }
    );
    backupPlan.addDependsOn(valut);

    new backup.CfnBackupSelection(scope, "game-studio-ebs-backup-selection", {
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
