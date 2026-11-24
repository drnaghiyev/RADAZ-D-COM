param(
    [Parameter(Mandatory=$true)][string]$ViewerRoot,
    [string]$AndroidSdk = $(if ($env:ANDROID_SDK_ROOT) {$env:ANDROID_SDK_ROOT} else {Join-Path $env:LOCALAPPDATA 'Android/Sdk'}),
    [string]$Jdk = $env:JAVA_HOME,
    [string]$ViewerSource = (Join-Path $PSScriptRoot '../outputs/public-network-release')
)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$source = (Resolve-Path -LiteralPath $ViewerRoot).Path
if (!(Test-Path -LiteralPath (Join-Path $source 'dist/server/radaz-build.json'))) {throw 'A complete RADAZ production build is required.'}
if (!$Jdk -or !(Test-Path -LiteralPath (Join-Path $Jdk 'bin/javac.exe'))) {throw 'Set JAVA_HOME or pass -Jdk for JDK 17 or 21.'}
$env:JAVA_HOME = $Jdk
$bt = Join-Path $AndroidSdk 'build-tools/36.0.0'
$platform = Join-Path $AndroidSdk 'platforms/android-36/android.jar'
function Run([string]$program,[string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) {throw "$program failed ($LASTEXITCODE)"}
}
$work = Join-Path $project ('build/' + [Guid]::NewGuid().ToString('N'))
$assets = Join-Path $work 'assets'
$classes = Join-Path $work 'classes'
$dex = Join-Path $work 'dex'
$keys = Join-Path $project '.local'
$out = Join-Path $project 'out'
foreach ($dir in @($assets,$classes,$dex,$keys,$out)) {$null=New-Item -ItemType Directory -Path $dir -Force}
if ((Get-Content -Raw -LiteralPath (Join-Path $source 'dist/server/radaz-build.json') | ConvertFrom-Json).product.version -ne '0.2.94') {throw 'This Android build requires RADAZ 0.2.94.'}
Run 'node' @((Join-Path $project 'build-tablet-viewer.mjs'),(Resolve-Path -LiteralPath $ViewerSource).Path,$assets)
$compiled = Join-Path $work 'res.zip'
$unsigned = Join-Path $work 'unsigned.apk'
Run (Join-Path $bt 'aapt2.exe') @('compile','--dir',(Join-Path $project 'res'),'-o',$compiled)
Run (Join-Path $bt 'aapt2.exe') @('link','--manifest',(Join-Path $project 'AndroidManifest.xml'),'-I',$platform,'-R',$compiled,'-o',$unsigned)
$sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $project 'src') -Recurse -File -Filter '*.java' | Select-Object -ExpandProperty FullName)
$boot=(Join-Path $bt 'core-lambda-stubs.jar') + [IO.Path]::PathSeparator + $platform
Run (Join-Path $Jdk 'bin/javac.exe') (@('-encoding','UTF-8','-source','8','-target','8','-Xlint:-options','-bootclasspath',$boot,'-d',$classes)+$sourceFiles)
$jar = Join-Path $work 'classes.jar'
Run (Join-Path $Jdk 'bin/jar.exe') @('cf',$jar,'-C',$classes,'.')
Run (Join-Path $Jdk 'bin/java.exe') @('-cp',(Join-Path $bt 'lib/d8.jar'),'com.android.tools.r8.D8','--min-api','26','--lib',$platform,'--output',$dex,$jar)
# Add the verified web assets verbatim, including the original /_next directory.
Run (Join-Path $Jdk 'bin/jar.exe') @('uf',$unsigned,'-C',$dex,'classes.dex','-C',$work,'assets')
$aligned = Join-Path $work 'aligned.apk'
Run (Join-Path $bt 'zipalign.exe') @('-f','-P','16','4',$unsigned,$aligned)
$keystore = Join-Path $keys 'tablet.p12'
$protected = Join-Path $keys 'signing.dpapi'
if ((Test-Path -LiteralPath $keystore) -ne (Test-Path -LiteralPath $protected)) {throw 'Private tablet signing files are incomplete.'}
if (!(Test-Path -LiteralPath $protected)) {
    $random = [byte[]]::new(32)
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try {$rng.GetBytes($random)} finally {$rng.Dispose()}
    $env:RADAZ_TABLET_STORE_PASS=[Convert]::ToBase64String($random)
    $secured=ConvertTo-SecureString $env:RADAZ_TABLET_STORE_PASS -AsPlainText -Force
    ConvertFrom-SecureString $secured | Set-Content -LiteralPath $protected
    Run (Join-Path $Jdk 'bin/keytool.exe') @('-genkeypair','-alias','tablet','-keyalg','RSA','-keysize','3072','-validity','9000','-storetype','PKCS12','-keystore',$keystore,'-storepass:env','RADAZ_TABLET_STORE_PASS','-keypass:env','RADAZ_TABLET_STORE_PASS','-dname','CN=RADAZ Tablet Personal Build','-noprompt')
} else {
    $secured=ConvertTo-SecureString (Get-Content -LiteralPath $protected -Raw).Trim()
    $env:RADAZ_TABLET_STORE_PASS=[Net.NetworkCredential]::new('tablet',$secured).Password
}
$apk=Join-Path $out 'RADAZ-Tablet-0.2.94-4.apk'
try {
    Run (Join-Path $Jdk 'bin/java.exe') @('-jar',(Join-Path $bt 'lib/apksigner.jar'),'sign','--ks',$keystore,'--ks-key-alias','tablet','--ks-pass','env:RADAZ_TABLET_STORE_PASS','--key-pass','env:RADAZ_TABLET_STORE_PASS','--v4-signing-enabled','false','--out',$apk,$aligned)
} finally {Remove-Item Env:RADAZ_TABLET_STORE_PASS -ErrorAction SilentlyContinue}
Run (Join-Path $Jdk 'bin/java.exe') @('-jar',(Join-Path $bt 'lib/apksigner.jar'),'verify','--verbose',$apk)
Run (Join-Path $bt 'zipalign.exe') @('-c','-P','16','4',$apk)
Write-Output $apk
