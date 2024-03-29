# Simple Game Studio on AWS

Note: refer [hands-on doc](https://catalog.us-east-1.prod.workshops.aws/workshops/1f1e1c90-886b-47c7-a5bd-cb6fb26a3c37/ja-JP) for the detail (written only in Japanese).

With this CDK application, you can easily build a simple and customizable game studio on AWS. The default setting covers a build farm, a source code repository, CI tool, workstation, and backups. If you are suffered from long build time, build farm management, slow response from CI tool, this project could help your time.

![Architecture](docs/architecture.png)

## Getting Started

### Prerequisites

- AWS Account, [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
    - Preferably, **a dedicated AWS account for this project** since we can easily track costs
    - Setup your credential with `aws configure`
- [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html#getting_started_prerequisites)
    - Install Node.js and CDK

### Pre-caution

By deploying this project into an AWS account, it will exceed Free Tier.
To avoid unnecessary charges, [clean up the environment](#clean-up) when you finish trying the project.

### Deployment (without customize)

CDK do the complex construction on behalf of you. You can customize what will be created by modifying `lib/gamestudio-stack.ts` and `bin/automated.ts`.

1. find out your global IP
    - CLI: `$ curl http://checkip.amazonaws.com/`
    - or, use your IP for your office network
1. `$ npm i` in the root directory.
1. `$ ALLOW_CIDR=<YOUR_IP>/32 cdk deploy '*'` in the root directory.
1. Type `yes` for security questions, and wait to complete. You can also watch the progress in AWS Cloudformation console.
    1. Debug it by reading error messages if some problem occurred.
1. Configure services as you like. Guide for each service is [written below](#service-guide).

### Deployment (with customize)

Make changes to .ts files under `lib/stacks/`, modify `bin/` for your own stacks, and deploy it by `cdk deploy <YourStackName>`.
[Stack explanation](#stack) will help your understanding.

## <a id="service-guide"></a> Service Guides

### NICE-DCV (VDI) environment

You can launch a virtual desktop instance in AWS easily with a EC2 Launch Temaplete feature.

1. First of all, you have to create a keypair to obtain Administrator's password. Go to `EC2` -> `Key pairs`, then create a keypair, named as `windows`.
2. Go to `EC2` -> `Launch Templates`, and select `workstation-template`.
3. Press `Actions` -> `Launch instance from template`.
4. Modify these following settings, then press `Launch instance`.
  - Change `Source template version` to the latest version
  - Change `Amazon Machine Image (AMI)` if you need. The default use vanilla Windows server.
  - Change `Instance type` if you need.
  - Select `windows` as `Key pair name`.
  - Select `SetupStack/aws-game-studio-vpc/PublicSubnet1` subnet as `Network settins` -> `Subnet`.
  - Change `EBS Volumes` if you need. The default is 300GB gp3 (SSD) EBS.

After launching an instance, you have to wait for about 10 minutes.
Then find launched instance in `EC2` -> `Instances`, select it, click `Connect`, and open `RDP client` tab.
This shows `Public DNS` and `Password`, which can be decrypted by `windows` key pair.

Download NICE-DCV client from [the official page](https://download.nice-dcv.com/) in the `NICE DCV 202x.x Client` section.
Be careful not to download a server!
Install it, then access to the `Public DNS`, trust it, and login as an `Administrator` and the decrypted password.

That's all!
Now you can experience the desktop environment in the cloud.
As a side note, you Check the latency and network status in `Streaming mode` menu.

### Jenkins

Jenkins is open only in the internal network (VPC).
To access web GUI, access `http://jenkins.gamestudio.aws.internal/` via NICE-DCV VDI instances.
Login user is `admin`, and password is also `admin` as a default settings.
Optionally, you can open `TCP:80` to the internet by modifing the attached security group.

Jenkins has some example jobs.
Explorer them to find out what we can do.

### Jenkins Jobs

If you have completed Jenkins setup, you can freely create your own Jenkins jobs. There are some samples:

- Backup
    - In this CDK script, `/usr/local/backup-jenkins.sh` has been created in the Jenkins instance. This script take JENKINS_HOME snapshot as a zip file and put it on a S3 bucket. You can create a Jenkins job which runs every 6 hours to make full backup periodically. Notice that you should delete unused backups to avoid unnecessary charges. [Amazon S3 Glacier](https://aws.amazon.com/glacier/) will help to keep full backups.
- Launch Build Instance via a Jenkins job
    - Create a parameterized job (powered by [Parameterized Trigger](https://plugins.jenkins.io/parameterized-trigger/)) with "Build Script" (`./docs/run-instance.sh`).
        - Create parameters (written as environment variables in the script)
        - Some of the parameters are written in `/usr/local/env-vars-for-launching-buildnode.sh`
    - Tips: refer `./docs/build-ue4.ps1` for detail

### Create Build Node AMI

You can easily create build nodes for heavy build tasks via [Launch Template](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-launch-templates.html).
First of all, you should create Amazon Machine Image (AMI), which is used as a base image for build nodes.

Open "EC2" -> "Launch Templates", and find a template named `build-machine-image-template`.
Select it, and "Launch instance from template" from "Actions ▼".

Launch with these settings:

- "Source template version": choose the latest one
- "Instance type": can be changed, if you would like to use another one
- "Key Pair": if you need to log in as Administrator, you have to specify this
- "Network settings": choose one subnet which is named as "PublicSubnet*"
- "Storage": can be changed, if you will run out of the disk space
- "Advanced details"
    - "User data": can be changed, if you would like to setup when 

Launch an instance, wait for minutes, and log into the instance with RDP.
You can login as `buildnode` with a password in AWS Secrets Manager (named as `buildnodeimageBuildNodeUser...`).
This user has administrative privileges.

Setup as you like, and then, launch `EC2Launch` in Windows and click "Shutdown with Sysprep".
Go back to EC2 Console, select the instance, click "Actions ▼" -> "Image" -> "Create image".
Type your wonderful "Image name", then click "Create Image".

After few minutes... Wow! You got an AMI for your build nodes!
You can see your AMI in "AMIs" menu.

### (Example) UE4 Setup on Build Nodes

1. RDP into your instance
1. Download UE4 source (from Github, internal repository, or upload to S3 and download it)
1. Place UE4 files into `C:\UE4`
1. Setup build environments
1. Execute `C:\UE4\Setup.bat` and `C:\UE4\GenerateProjectFiles.bat`
1. Build the Engine (e.g. `call C:\UE4\Engine\Build\BatchFiles\Rebuild.bat -Target="ShaderCompileWorker Win64 Development" -Target="UE4Editor Win64 Development" -WaitMutex -FromMsBuild`)
1. Run `sysprep`, and make your build image (refer: https://aws.amazon.com/jp/premiumsupport/knowledge-center/sysprep-create-install-ec2-windows-amis/)

Tips: Refer `docs/setup-ue4.ps1` for automation.
Steps are 1) Place UE4 source to your resource bucket, 2) modify variables at the top of the script, 3) and run it.

### Launch Build Nodes

1. Open Jenkins
1. "Manage Jenkins" -> "New Node"
    - Name: amazing-name
    - Select "Permanent Agent"
1. In setting page:
    - Remote root directory: `C:\jenkins`
    - Labels: whatever-you-like (e.g. `ec2 windows ue4`)
1. Open the created agent page, note the **name** and **secrets**

Then, run an instance for a build node with the AMI (you have created the above section).
You have to connect Jenkins instance from a build node.
Of course, you can automate it.
Please see the sample script: `./docs/run-instance.sh`.

### SimpleAD

SimpleAD is one of an Active Directory implementation in [AWS Directory Service](https://docs.aws.amazon.com/directoryservice/latest/admin-guide/directory_simple_ad.html).
It is easy-to-use Active Directory.
If you already have company-wide Active Directory, or need complex functionality, use another Active Directory instead of this SimpleAD.

In this script, all the instances in the created VPC can find SimpleAD via DNS.

### (Option) Join SimpleAD on Windows Servers

You can add your Windows server into SimpleAD directory by using the following command (replace placeholders).
In order not to expose `ADMIN_PASSWORD` to users, such steps should be done by AD administrator.

```powershell
$computer = Get-WmiObject -Class Win32_ComputerSystem
if ($computer.domain -eq 'WORKGROUP') {
  $domain = '<YOUR_FULL_QUALIFIED_DOMAIN>'
  $password = '<ADMIN_PASSWORD>' | ConvertTo-SecureString -asPlainText -Force
  $Administrator = '<NETBIOS_NAME>\Administrator'
  $credential = New-Object System.Management.Automation.PSCredential($Administrator,$password)
  Add-Computer -DomainName $domain -Credential $credential -restart
}
```

## <a id="stack"></a> Stack Explanation

There are some stacks to build your own game studio on AWS.
You can deploy with this command: `cdk deploy <STACK_NAME>` or if you would like to deploy all, use `cdk deploy '*'`.

These are pre-build stacks for demonstration.

- SetupStack - required for any other stack
    - The very first stack to deploy. This prepare some buckets, vpc, internal DNS, and backups.
- VCSStack
    - Creates VCS servers (currently a simple SVN server). 
    - after deploying, find your SVN password in AWS Secrets Manager
    - The SVN instance can be accessed by Systems Manager, Public IP, Private Ip, and `vcs.gamestudio.aws.internal` in the same VPC.
    - Backup: AWS Backup (EBS Snapshot, daily, 10-days retention)
- CICDStack
    - Creates Jenkins server
    - Access with SSM Start-sesison, and get a secret from `/var/lib/jenkins/secrets/initialAdminPassword`. Then, access the endpoint and setup your jenkins.
        - fix JNLP Agent port to `50000`
        - check "Configure Global Security" -> "CSRF Protection" -> "Enable proxy compatibility"
        - Jenkins URL: `http://jenkins.gamestudio.aws.internal/` for JNLP agent connectivity
    - Backup: manually create a Jenkins job to call `/usr/local/jenkins-backup.sh`. This script compress JENKINS_HOME and upload it to a S3 bucket which is created in `SetupStack`.
- BuildNodeImageStack
    - Creates an EC2 Instance for a template of build nodes
    - Access with RDP (user: `buildnode`, password is in the Secrets Manager), or you can set your keypair with modifiying this stack
    - Setup your build environment, such as UE4, Unity, and other game engines. After finishing construction, use [sysprep](https://aws.amazon.com/jp/premiumsupport/knowledge-center/sysprep-create-install-ec2-windows-amis/) and make your build machine image.
        - If you want to run "Integrated UE4 Build demo", UE4 Engine has to be placed at `C:\UE4\bin\UnrealEnging4.exe`, and Amazon Corretto installed
    - the default instance type is `c5.18xlarge`
- WorkstationStack
    - Creates a EC2 Launch Template for GPU workstation instances

## Tips

### Design for Failure

It is amazingly important to be ready for disaster in order not to break your studio and know the environment better.
Let's try these cases before you run this CDK in production.
Listed cases are very limited, so feel free to add your own cases!

- Shutdown Jenkins controller server. How to restore the settings?
- Shutdown a workstation. How to restore the data?
- Change userdata in CDK and deploy it. How to debug it?
- Remove some of stacks. How to deploy it again?

### Restore Jenkins

If you enabled Jenkins backup job, it is easy to restore Jenkins from the backup.

1. SSH (or start-session) into a new Jenkins instance
1. find the latest backup in S3 bucket (e.g. `$ aws s3 ls setupstack-jenkinsbackupbucketxxxxxxxxxx/jenkins-backup/`)

after that,

```bash
$ aws s3 cp s3://<YOUR_LATEST_BACKUP>.tar.gz .
$ sudo tar xvf <YOUR_TAR_FILE>.tar.gz -C /var/lib/jenkins/
$ sudo chown -R jenkins:jenkins /var/lib/jenkins/
$ sudo systemctl restart jenkins
```

### Update all the CDK dependencies

```bash
$ npm install -g aws-cdk  # Update CDK CLI
$ npm i -g npm-check-updates
$ ncu -u
$ npm i
```

`cdk diff` tells you if there are breaking changes.

### <a id="clean-up"></a> Clean up

`$ cdk destroy` is the fastest method to clean up.
A common error to prevent deletion is `X has dependencies`.
If you see this kind of message, read error messages and delete resources manually before running `destroy` command again.
You can also delete stacks in AWS Cloudformation console.

Even after destroying, S3 buckets, keys, some EBSs are not deleted (`status: DELETE_SKIPPED` in CloudFormation console) to prevent backups deleted.
You can manually delete it if you are just trying this repository.
Using AWS CLI is a good idea to delete multiple buckets.
(e.g. `$ aws s3 ls | cut -d" " -f 3 | grep  '^setupstack-*' | xargs -I{} aws s3 rb s3://{}`. appending `--force` will delete all the contents in found buckets. Be careful!)

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
