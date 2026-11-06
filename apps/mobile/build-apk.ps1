param([string]$ApiUrl='https://lichcarlos.top/charge-api',[string]$Architectures='arm64-v8a,x86_64',[switch]$Offline,[string]$InitScript='')
$ErrorActionPreference='Stop'
$taskRoot=Resolve-Path (Join-Path $PSScriptRoot '../..')
if(-not $ApiUrl.StartsWith('https://')){throw 'Release APK requires an HTTPS API URL'}
Push-Location $taskRoot
$taskPreviousTemp=$env:TEMP
$taskPreviousTmp=$env:TMP
try {
    # Keep release Metro's cache separate from the running development server.
    $taskBuildTemp=Join-Path $taskRoot '.work/android-build-temp'
    New-Item -ItemType Directory -Path $taskBuildTemp -Force | Out-Null
    $env:TEMP=$taskBuildTemp
    $env:TMP=$taskBuildTemp
    node server/ops/create-android-signing.mjs
    if($LASTEXITCODE -ne 0){throw 'Signing key initialization failed'}
    $taskSigning=Get-Content .work/android-signing/credentials.json -Raw | ConvertFrom-Json
    $env:CHARGE_KEYSTORE_FILE=Join-Path $taskRoot '.work/android-signing/charge-release.keystore'
    $env:CHARGE_KEYSTORE_PASSWORD=$taskSigning.storePassword
    $env:CHARGE_KEY_ALIAS=$taskSigning.alias
    $env:CHARGE_KEY_PASSWORD=$taskSigning.keyPassword
    $env:EXPO_PUBLIC_API_URL=$ApiUrl.TrimEnd('/')
    $env:NODE_ENV='production'
    $env:EAS_BUILD_PROFILE='production'
    # React Native passes a relative entry path on Windows; resolve it at the app root.
    $env:EXPO_NO_METRO_WORKSPACE_ROOT='1'
    $env:CHARGE_METRO_WORKERS='2'
    $env:ANDROID_HOME='D:/develop/Android/SDK'
    # Limit D8/JVM worker pools and leave native allocation space below the Java heap.
    $env:JAVA_TOOL_OPTIONS="-XX:ActiveProcessorCount=2 -XX:HeapBaseMinAddress=8g -Djdk.net.unixdomain.tmpdir=$taskRoot/.work -Djava.io.tmpdir=$taskRoot/.work"
    Set-Location apps/mobile/android
    if(-not $InitScript){$InitScript=Join-Path $taskRoot 'server/ops/android-build.init.gradle'}
    $taskGradleArgs=@('assembleRelease','--no-daemon','--max-workers=1','--info','-Dorg.gradle.internal.http.connectionTimeout=20000','-Dorg.gradle.internal.http.socketTimeout=30000',"-PreactNativeArchitectures=$Architectures")
    if($Offline){$taskGradleArgs+='--offline'}
    if($InitScript){$taskGradleArgs+=@('--init-script',$InitScript)}
    .\gradlew.bat @taskGradleArgs
    if($LASTEXITCODE -ne 0){throw 'Android release build failed'}
    $taskVersion=(Get-Content (Join-Path $PSScriptRoot 'app.json') -Raw | ConvertFrom-Json).expo.version
    $taskOutput=Join-Path $taskRoot "outputs/charge-$taskVersion.apk"
    New-Item -ItemType Directory -Path (Split-Path $taskOutput) -Force | Out-Null
    Copy-Item -LiteralPath app/build/outputs/apk/release/app-release.apk -Destination $taskOutput -Force
    Get-Item -LiteralPath $taskOutput | Select-Object FullName,Length
    Get-FileHash -LiteralPath $taskOutput -Algorithm SHA256
} finally {
    Remove-Item Env:CHARGE_KEYSTORE_PASSWORD,Env:CHARGE_KEY_PASSWORD -ErrorAction SilentlyContinue
    $env:TEMP=$taskPreviousTemp
    $env:TMP=$taskPreviousTmp
    Pop-Location
}
