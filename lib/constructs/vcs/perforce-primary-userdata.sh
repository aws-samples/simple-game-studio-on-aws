#!/usr/bin/env bash

set -eux

ServerID="p4primary"

yum -y update

mkfs -t xfs /dev/sdb && mkdir /hxdepots && mount /dev/sdb /hxdepots
mkfs -t xfs /dev/sdc && mkdir /hxlogs && mount /dev/sdc /hxlogs
mkfs -t xfs /dev/sdd && mkdir /hxmetadata && mount /dev/sdd /hxmetadata
blkid /dev/sdb | awk -v OFS="   " '{print $2,"/hxdepots","xfs","defaults,nofail","0","2"}' >>/etc/fstab
blkid /dev/sdc | awk -v OFS="   " '{print $2,"/hxlogs","xfs","defaults,nofail","0","2"}' >>/etc/fstab
blkid /dev/sdd | awk -v OFS="   " '{print $2,"/hxmetadata","xfs","defaults,nofail","0","2"}' >>/etc/fstab

cat <<'EOF' >/etc/yum.repos.d/perforce.repo
[perforce]
name=Perforce
baseurl=http://package.perforce.com/yum/rhel/7/x86_64/
enabled=1
gpgcheck=1
EOF

chmod 000644 /etc/yum.repos.d/perforce.repo
chown root:root /etc/yum.repos.d/perforce.repo

rpm --import https://package.perforce.com/perforce.pubkey
yum install -y helix-p4d

adduser -g perforce -G adm,wheel p4admin
mkdir /home/p4admin/.ssh
cp /home/ec2-user/.ssh/authorized_keys /home/p4admin/.ssh
chown p4admin:perforce --recursive /home/p4admin/.ssh
chmod 700 /home/p4admin/.ssh
chmod 600 /home/p4admin/.ssh/authorized_keys
echo 'p4admin         ALL=(ALL)       NOPASSWD: ALL' >> /etc/sudoers

wget 'https://swarm.workshop.perforce.com/projects/perforce-software-sdp/download/downloads/sdp.Unix.tgz' -O /tmp/sdp.Unix.tgz
cd /tmp/
tar -xvf /tmp/sdp.Unix.tgz
mv /tmp/sdp /hxdepots/sdp

cp /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg.bak
sudo sed -i -e 's/DB1=.*/DB1=hxmetadata/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg
sed -i -e 's/DB2=.*/DB2=hxmetadata/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg
sed -i -e 's/DD=.*/DD=hxdepots/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg
sed -i -e 's/LG=.*/LG=hxlogs/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg
sed -i -e 's/OSUSER=.*/OSUSER=p4admin/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg
sed -i -e 's/OSGROUP=.*/OSGROUP=perforce/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg
sed -i -e 's/CASE_SENSITIVE=.*/CASE_SENSITIVE=0/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg
sed -i -e 's/MAILHOST=.*/MAILHOST=localhost/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg

sed -i -e 's/SSL_PREFIX=.*/SSL_PREFIX=/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg

# sed -i -e 's/P4DNSNAME=.*/P4DNSNAME=ip-10-0-0-63.${AWS::Region}.compute.internal/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg

sed -i -e 's/COMPLAINFROM_DOMAIN=.*/COMPLAINFROM_DOMAIN=amazonaws.com/g' /hxdepots/sdp/Server/Unix/setup/mkdirs.cfg
ln -s /opt/perforce/bin/p4 /hxdepots/sdp/Server/Unix/p4/common/bin/p4
ln -s /opt/perforce/sbin/p4d /hxdepots/sdp/Server/Unix/p4/common/bin/p4d
/hxdepots/sdp/Server/Unix/setup/mkdirs.sh 1

cat <<EOF >/etc/systemd/system/p4d_1.service
                [Unit]
                Description=Helix Server Instance 1
                Documentation=http://www.perforce.com/perforce/doc.current/manuals/p4sag/index.html
                Requires=network.target network-online.target
                After=network.target network-online.target

                [Service]
                Type=forking
                TimeoutStartSec=60s
                TimeoutStopSec=60s
                ExecStart=/p4/1/bin/p4d_1_init start
                ExecStop=/p4/1/bin/p4d_1_init stop
                User=p4admin

                [Install]
                WantedBy=multi-user.target
EOF

chmod 000400 /etc/systemd/system/p4d_1.service
chown p4admin:perforce /etc/systemd/system/p4d_1.service

systemctl enable p4d_1
systemctl start p4d_1
echo ${ServerID} > /p4/1/root/server.id

/hxdepots/sdp/Server/setup/configure_new_server.sh 1


cat <<EOF > /tmp/p4user
User: p4admin
Email: p4admin@p4primary
FullName: p4admin
EOF
P4PORT=localhost:1666 p4 user -f -i < /tmp/p4user

sudo su - p4admin <<EOSU
set -eux
export P4PORT=localhost:1666
cat <<EOF > /tmp/p4depot_repository
Depot:  repository
Owner:  p4admin
Description:
        Created by p4admin.
Type:   local
Map:    repository/...
EOF
p4 depot -i < /tmp/p4depot_repository
# create client
cat <<EOF > /tmp/p4client
Client: p4admin
Root: /home/p4admin
View:
  //spec/... //p4admin/spec/...
  //repository/... //p4admin/repository/...
  //depot/... //p4admin/depot/...
EOF
p4 client -i < /tmp/p4client
cd /home/p4admin/
mkdir repository
cd repository
wget -O TestProject.zip 'https://gametech-cfn-templates-public.s3.amazonaws.com/gdoa/TestProject.zip' 
unzip -d TestProject TestProject.zip
rm TestProject.zip
wget -O BlankProject.zip 'https://gametech-cfn-templates-public.s3.amazonaws.com/gdoa/BlankProject.zip'
unzip -d BlankProject BlankProject.zip
rm BlankProject.zip
p4 -c p4admin add ./...
p4 -c p4admin submit -d 'initial'
EOSU
