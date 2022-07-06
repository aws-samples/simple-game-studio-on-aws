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