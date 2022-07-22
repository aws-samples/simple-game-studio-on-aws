#!/bin/sh

set -eux

# load environment variables
source /usr/local/env-vars-for-launching-buildnode.sh

# should be a region: e.g. 'ap-northeast-1'
export AWS_DEFAULT_REGION=${BN_REGION}

cat <<'EOF' > /tmp/run.py
import boto3
import os
from string import Template
EOF

# interpolate bucket name
cat <<EOF >> /tmp/run.py
build_artifact_bucket = '${BUILD_ARTIFACT_BUCKET}'
fastbuild_brokerage_host = os.environ.get('fastbuild_brokerage_host')
EOF

cat <<'EOF' >> /tmp/run.py
class RunInstanceParam:
    def __init__(self):
        super().__init__()
        self.instance_type = os.environ.get('instance_type')
        self.ami = os.environ.get('ami')


def run_instance(params: RunInstanceParam):
    client = boto3.client('ec2')
    response = client.run_instances(
        BlockDeviceMappings=[
            {
                'DeviceName': '/dev/sda1',
                'Ebs': {
                    'DeleteOnTermination': True,
                    'VolumeSize': 300,
                    'VolumeType': 'gp3',
                },
            },
        ],
        ImageId=params.ami,
        InstanceType=params.instance_type,
        # KeyName='',
        MaxCount=1,
        MinCount=1,
        #Placement={
        #    'Tenancy': 'dedicated',  # can be changed
        #},
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
                        'Key': 'Purpose',
                        'Value': 'buildnode'
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

user_data_raw = Template('''
    <powershell>
    $ErrorActionPreference = "Stop"

    $Env:BuildArtifactBucketName = "${build_artifact_bucket}"

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

    # install 7-zip
    
    $ff_url = "https://www.7-zip.org/a/7z1900-x64.msi"
    $wc = New-Object net.webclient
    $output = "C:\\7zip.msi"        
    $wc.Downloadfile($ff_url, $output)
    $logFile = "C:\\7zip.log"
    Start-Process msiexec.exe -Wait -ArgumentList "/I $output /quiet /norestart /L*v $logFile"
        
    # install corretto

    $url = "https://d3pxv6yz143wms.cloudfront.net/11.0.3.7.1/amazon-corretto-11.0.3.7.1-1-windows-x64.msi"
    $output = "C:\\amazon-corretto.msi"
    (New-Object System.Net.WebClient).DownloadFile($url, $output)
    $logFile = "C:\\corretto.log"
    Start-Process msiexec.exe -Wait -ArgumentList "/I $output /quiet /norestart /L*v $logFile"

    [Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Amazon Corretto\jdk11.0.3_7")
    [System.Environment]::SetEnvironmentVariable("PATH", $Env:Path + ";$($Env:JAVA_HOME)\bin", "User")
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

    # install and run FastBuild
    
    $zipfile = "C:\\fastbuild.zip"
    $targetPath = "C:\\fastbuild"
    $sharedFolder = "\\\\${fastbuild_brokerage_host}\shared"
    echo $sharedFolder
    Invoke-WebRequest -Uri "https://fastbuild.org/downloads/v1.06/FASTBuild-Windows-x64-v1.06.zip" -OutFile $zipfile
    Expand-Archive $zipfile -DestinationPath $targetPath
    
    net use $sharedFolder /user:Accounts\\fb ChangeME!
    netsh advfirewall firewall add rule name="FASTBuild--Port 31264" dir=in action=allow protocol=TCP localport=31264

    $Env:FASTBUILD_BROKERAGE_PATH = "$sharedFolder"
    [System.Environment]::SetEnvironmentVariable("FASTBUILD_BROKERAGE_PATH","$sharedFolder")
    & "$targetPath\FBuildWorker.exe"

    # setup jenkins agent

    Update-Last-Active-Tag

    $url = "http://$($jenkinsHost)/jnlpJars/agent.jar"
    $output = "C:\\agent.jar"
    (New-Object System.Net.WebClient).DownloadFile($url, $output)

    Update-Last-Active-Tag

    java -jar C:\\agent.jar -jnlpUrl http://"$jenkinsHost"/computer/"$jenkinsAgentName"/slave-agent.jnlp -secret "$jenkinsSecret" -workDir C:\jenkins

    </powershell>
    <persist>true</persist>
''')
user_data = user_data_raw.safe_substitute(
    build_artifact_bucket=build_artifact_bucket,
    fastbuild_brokerage_host=fastbuild_brokerage_host,
)

params: RunInstanceParam = RunInstanceParam()
params.subnet_id = os.environ.get('BN_SUBNET_ID')

# able to read & make change on tag
params.instance_profile_arn = os.environ.get('BN_INSTANCE_PROFILE_ARN')

params.sg_id = os.environ.get('BN_SG_ID')
params.user_data = user_data
params.jenkins_host = 'jenkins.gamestudio.aws.internal'
params.jenkins_secret =  os.environ.get('jenkins_secret')
params.jenkins_agent_name =  os.environ.get('jenkins_agent_name')

resp = run_instance(params)
print(resp)

EOF

python3 /tmp/run.py
