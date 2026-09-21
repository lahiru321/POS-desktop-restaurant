# Rebuild the StoreX Restaurant Windows desktop installer for this copy.
# Reuses the already-staged resources/jre and resources/postgres-bin (unchanged);
# rebuilds the backend fat jar and the Next.js standalone web bundle, then packages.
#
# Run:  powershell -ExecutionPolicy Bypass -File ".\build-installer.ps1"

$ErrorActionPreference = 'Stop'
$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend   = Join-Path $Root 'pos-backend'
$Frontend  = Join-Path $Root 'pos-frontend'
$Resources = Join-Path $Frontend 'resources'

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# 1. Backend fat jar
Step 'Building backend fat jar'
Push-Location $Backend
try { & .\mvnw.cmd -q -DskipTests package; if ($LASTEXITCODE -ne 0) { throw "Maven build failed" } }
finally { Pop-Location }

$JarSrc = Join-Path $Backend 'target\pos-backend-0.0.1-SNAPSHOT.jar'
$JarDst = Join-Path $Resources 'backend\pos-backend.jar'
if (-not (Test-Path $JarSrc)) { throw "Backend jar not found at $JarSrc" }
# resources/ is gitignored, so on a fresh checkout only jre/ and postgres-bin/ are
# hand-copied in — backend/ may not exist yet.
New-Item -ItemType Directory -Force -Path (Split-Path $JarDst) | Out-Null
Copy-Item $JarSrc $JarDst -Force
Write-Host "Staged backend jar -> $JarDst"

# 2. Next.js standalone build
Step 'Building Next.js standalone server'
Push-Location $Frontend
try { & npm run build; if ($LASTEXITCODE -ne 0) { throw "next build failed" } }
finally { Pop-Location }

$WebDst = Join-Path $Resources 'web'
Remove-Item -Recurse -Force $WebDst -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $WebDst | Out-Null

$Standalone = Join-Path $Frontend '.next\standalone'
if (-not (Test-Path $Standalone)) { throw "Standalone build missing at $Standalone" }
Copy-Item (Join-Path $Standalone '*') $WebDst -Recurse -Force

$StaticSrc = Join-Path $Frontend '.next\static'
if (Test-Path $StaticSrc) {
    New-Item -ItemType Directory -Force -Path (Join-Path $WebDst '.next') | Out-Null
    Copy-Item $StaticSrc (Join-Path $WebDst '.next\static') -Recurse -Force
}
$PublicSrc = Join-Path $Frontend 'public'
if (Test-Path $PublicSrc) { Copy-Item $PublicSrc (Join-Path $WebDst 'public') -Recurse -Force }
Write-Host "Staged web -> $WebDst"

# 3. Compile Electron TS (+ copy activation/first-run html) and package
Step 'Compiling Electron main/preload'
Push-Location $Frontend
try {
    & npm run electron:tsc; if ($LASTEXITCODE -ne 0) { throw "electron:tsc failed" }
    Step 'Running electron-builder (NSIS x64)'
    & npx electron-builder --win nsis --x64; if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
}
finally { Pop-Location }

Step 'Done'
Get-ChildItem (Join-Path $Frontend 'dist') -Filter '*-Setup-*.exe' | ForEach-Object {
    Write-Host ("Installer: {0}  ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB))
}
