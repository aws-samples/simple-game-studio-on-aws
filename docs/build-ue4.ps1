$ErrorActionPreference = "Stop"

$PWD = Get-Location
$ProjectFile = "$PWD\$Env:ProjectName.uproject" # change this into your project file path
$ArtifactBucket = $Env:BuildArtifactBucketName # change this into your bucket name for build artifacts
$ArchiveDir = "C:\archive"

# if you need
# &"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="ShaderCompileWorker Win64 Development" -Target="UE4Editor Win64 Development" -WaitMutex -FromMsBuild
# &"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="UnrealPak Win64 Development" -WaitMutex -FromMsBuild
# &"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="UE4Game Win64 Shipping" -WaitMutex -FromMsBuild

if (Test-Path $ArchiveDir) { Remove-Item -Recurse $ArchiveDir }
mkdir $ArchiveDir

# if you need
# Start-Process -FilePath "C:\UE4\Engine\Binaries\Win64\UE4Editor.exe" -ArgumentList "$ProjectFile -run=DerivedDataCache -fill" -Wait -NoNewWindow
# &"C:\UE4\Engine\Binaries\Win64\UE4Editor-Cmd.exe" $ProjectFile -run=resavepackages -buildlighting -AllowCommandletRendering -Messaging

&"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="UE4Game Win64 Debug" -project="$ProjectFile" -WaitMutex -FromMsBuild

Start-Process -FilePath "C:\UE4\Engine\Build\BatchFiles\RunUAT.bat" -ArgumentList "-ScriptsForProject=$ProjectFile BuildCookRun -project=$ProjectFile -noP4 -clientconfig=Debug -serverconfig=Debug -ue4exe=C:\UE4\Engine\Binaries\Win64\UE4Editor-Cmd.exe -utf8output -platform=Win64 -build -cook -map= -unversionedcookedcontent -compressed -stage -package -Messaging -archive -archivedirectory=$ArchiveDir -compile" -Wait -NoNewWindow

# Compress build artifacts
Start-Process -FilePath "C:\Program Files\7-Zip\7z.exe" -ArgumentList "a C:\archive.zip C:\archive" -Wait -NoNewWindow

$ts = Get-Date -UFormat %s -Millisecond 0
$filePath = "testgame-{0}.zip" -f $ts

Move-Item -Path C:\archive.zip -Destination C:\"$filePath"
echo "$filePath"
Write-S3Object -BucketName $ArtifactBucket -File C:\"$filePath" -key package/"$filePath"

echo "Write to $ArtifactBucket/package/$filePath"
