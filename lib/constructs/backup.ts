import { aws_backup, aws_iam, aws_kms } from "aws-cdk-lib";
import { Construct } from "constructs";

export class BackupPattern extends Construct {
  readonly BackupTagKey: string = "aws-backup";
  readonly BackupTagValue: string = "true";

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // create service role by myself
    const backupRole = new aws_iam.Role(scope, "game-studio-backup-role", {
      assumedBy: new aws_iam.ServicePrincipal("backup.amazonaws.com"),
    });

    backupRole.addManagedPolicy(
      aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AWSBackupOperatorAccess")
    );
    backupRole.addManagedPolicy(
      aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSBackupServiceRolePolicyForBackup"
      )
    );

    const valutKey = new aws_kms.Key(scope, "ValutDefaultKey", {
      enableKeyRotation: true,
      alias: "backup/default",
    });
    const valut = new aws_backup.CfnBackupVault(
      scope,
      "game-studio-backup-vault",
      {
        backupVaultName: "game-studio-backup-vault",
        encryptionKeyArn: valutKey.keyArn,
      }
    );
    const backupPlan = new aws_backup.CfnBackupPlan(
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

    new aws_backup.CfnBackupSelection(
      scope,
      "game-studio-ebs-backup-selection",
      {
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
      }
    );
  }
}
