#!/bin/sh

set -eux

# should be a region: e.g. 'ap-northeast-1'
export AWS_DEFAULT_REGION=$1

cat <<'EOF' > /tmp/run.py
import boto3
import os

class RunInstanceParam:
    def __init__(self):
        super().__init__()
        self.instance_type = os.environ.get('instance_type')
        self.ami = os.environ.get('ami')
        self.instance_profile_arn = ''


def run_instance(params: RunInstanceParam):
    client = boto3.client('ec2')
    response = client.run_instances(
        BlockDeviceMappings=[
            {
                'DeviceName': '/dev/sda1',
                'Ebs': {
                    'DeleteOnTermination': True,
                    'VolumeSize': 500,
                    'VolumeType': 'gp2',
                },
            },
        ],
        ImageId=params.ami,
        InstanceType=params.instance_type,
        # KeyName='',
        MaxCount=1,
        MinCount=1,
        Placement={
            'Tenancy': 'dedicated',  # can be changed
        },
        SecurityGroupIds=[
            params.sg_id,
        ],
        SubnetId=params.subnet_id,
        UserData=params.user_data,
        # DryRun=True | False,
        IamInstanceProfile={
            'Arn': params.instance_profile_arn,
        },
        TagSpecifications=[
            {
                'ResourceType': 'instance',
                'Tags': [
                    {
                        'Key': 'Name',
                        'Value': 'BuildNode'
                    },
                    {
                        'Key': 'ForJenkinsBuildNode',
                        'Value': 'dummy'
                    },
                    {
                        'Key': 'jenkins_host',
                        'Value': params.jenkins_host
                    },
                    {
                        'Key': 'jenkins_secret',
                        'Value': params.jenkins_secret
                    },
                    {
                        'Key': 'jenkins_agent_name',
                        'Value': params.jenkins_agent_name
                    },
                ]
            },
        ],
    )
    return response


user_data = '''
<powershell>
$ErrorActionPreference = "Stop"

function Update-Last-Active-Tag
{
    $InstanceID = Get-EC2InstanceMetadata -Category InstanceId
    $OwnerTag = New-Object Amazon.EC2.Model.Tag
    $OwnerTag.Key = "LastActive"
    $OwnerTag.Value = (New-TimeSpan -Start (Get-Date "01/01/1970") -End (Get-Date)).TotalSeconds
    New-EC2Tag -Resource $InstanceID -Tag $OwnerTag
}

Update-Last-Active-Tag

# pickup parameters

$instanceID = Get-EC2InstanceMetadata -Category InstanceId
$instance = (Get-EC2Instance -InstanceId $instanceID)
$instance.Instances.tags

$jenkinsHost = $instance.Instances.tags | ? { $_.key -eq "jenkins_host" } | select -expand Value
$jenkinsSecret = $instance.Instances.tags | ? { $_.key -eq "jenkins_secret" } | select -expand Value
$jenkinsAgentName = $instance.Instances.tags | ? { $_.key -eq "jenkins_agent_name" } | select -expand Value

Update-Last-Active-Tag

cd C:\\

# install corretto

$url = "https://d3pxv6yz143wms.cloudfront.net/11.0.3.7.1/amazon-corretto-11.0.3.7.1-1-windows-x64.msi"
$output = "C:\\amazon-corretto.msi"
(New-Object System.Net.WebClient).DownloadFile($url, $output)
$logFile = "C:\\corretto.log"
Start-Process msiexec.exe -Wait -ArgumentList "/I $output /quiet /norestart /L*v $logFile"

[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Amazon Corretto\jdk11.0.3_7")
[System.Environment]::SetEnvironmentVariable("PATH", $Env:Path + ";$($Env:JAVA_HOME)\bin", "User")
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# setup jenkins agent

Update-Last-Active-Tag

$url = "http://$($jenkinsHost):8080/jnlpJars/agent.jar"
$output = "C:\\agent.jar"
(New-Object System.Net.WebClient).DownloadFile($url, $output)

Update-Last-Active-Tag

java -jar C:\\agent.jar -jnlpUrl http://"$jenkinsHost":8080/computer/"$jenkinsAgentName"/slave-agent.jnlp -secret "$jenkinsSecret" -workDir C:\jenkins

</powershell>
<persist>true</persist>
'''


params: RunInstanceParam = RunInstanceParam()
params.subnet_id = os.environ.get('subnet_id')

# able to read & make change on tag
params.instance_profile_arn = os.environ.get('instance_profile_arn')

params.sg_id = os.environ.get('sg_id')
params.user_data = user_data
params.jenkins_host = os.environ.get('jenkins_host')
params.jenkins_secret =  os.environ.get('jenkins_secret')
params.jenkins_agent_name =  os.environ.get('jenkins_agent_name')

resp = run_instance(params)
print(resp)

EOF

python3 /tmp/run.py
