# build against {VCSROOT}\TestProj.uproject
$PWD = Get-Location
$ProjectName = "TestProj"
$ProjectFile = "$PWD\$ProjectName.uproject" # change this into your project file path
$ArtifactBucket = "<your-backet-for-artifact>" # change this into your bucket name for build artifacts
$ArchiveDir = "C:\archive"

# build Engine
&"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="ShaderCompileWorker Win64 Development" -Target="UE4Editor Win64 Development" -WaitMutex -FromMsBuild
&"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="UnrealPak Win64 Development" -WaitMutex -FromMsBuild
&"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="UE4Game Win64 Shipping" -WaitMutex -FromMsBuild

mkdir $ArchiveDir

&"C:\UE4\Engine\Binaries\Win64\UE4Editor.exe" $ProjectFile -run=DerivedDataCache -fill

&"C:\UE4\Engine\Binaries\Win64\UE4Editor-Cmd.exe" $ProjectFile -run=resavepackages -buildlighting -AllowCommandletRendering -Messaging

&"C:\UE4\Engine\Build\BatchFiles\RunUAT.bat" -ScriptsForProject=$ProjectFile BuildCookRun -project=$ProjectFile -noP4 -clientconfig=Shipping -serverconfig=Shipping -nocompileeditor -ue4exe=C:\UE4\Engine\Binaries\Win64\UE4Editor-Cmd.exe -utf8output -platform=Win64 -build -cook -map= -unversionedcookedcontent -compressed -stage -package -Messaging -archive -archivedirectory=$ArchiveDir -compile

# Compress build artifacts
Start-Process -FilePath "C:\Program Files\7-Zip\7z.exe" -ArgumentList "C:\archive.zip C:\archive" -Wait

$ts = Get-Date -UFormat %s -Millisecond 0
$filePath = "testgame-{0}.zip" -f $ts

Move-Item -Path C:\archive.zip -Destination C:\"$filePath"
Write-S3Object -BucketName $ArtifactBucket -File C:\"$filePath" -key package/"$filePath"
