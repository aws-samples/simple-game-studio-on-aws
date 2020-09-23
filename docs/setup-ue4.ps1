# run as an Administrator

$UE4SourceBucketName = "<Change me> e.g. setupstack-gamedevonawsresourcesbucket..."
$UE4SourceBucketKey = "<Change me> e.g. ue4/UnrealEngine-4.25.3-release.zip"
$UE4Version = "<Change me> e.g. 4.25.3"

Copy-S3Object -BucketName $UE4SourceBucketName -Key $UE4SourceBucketKey -LocalFile "C:\UE4.zip"
&"C:\Program Files\7-Zip\7z" x "C:\UE4.zip" -oC:\UE4_setup
        
cd "C:\UE4_setup\UnrealEngine-$UE4Version-release"

Get-Content Setup.bat | % { $_.Replace(".\Engine\Binaries\Win64\UnrealVersionSelector-Win64-Shipping.exe /register", "") } | Out-File -Encoding default .\Setup-nonstop.bat
.\Setup-nonstop.bat

.\GenerateProjectFiles.bat
cd ..

mv "C:\UE4_setup\UnrealEngine-$UE4Version-release" "C:\UE4"
rmdir "C:\UE4_setup"

# optional: compile Engine. this takes time, use a powerful instance
# &"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="ShaderCompileWorker Win64 Development" -Target="UE4Editor Win64 Development" -WaitMutex -FromMsBuild
# &"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="UnrealPak Win64 Development" -WaitMutex -FromMsBuild
# &"C:\UE4\Engine\Build\BatchFiles\Build.bat" -Target="UE4Game Win64 Shipping" -WaitMutex -FromMsBuild

# optional: if needed, this takes few minutes
icacls C:\UE4 /t /grant buildnode:F
