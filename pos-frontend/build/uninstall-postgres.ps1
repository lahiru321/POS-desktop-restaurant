# Tear down the bundled PostgreSQL service. Invoked by NSIS uninstaller.
# Args: $InstallDir, $KeepData ('yes'|'no')

param(
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [string]$KeepData = 'yes'
)

$ErrorActionPreference = 'Continue'
$ServiceName = 'StoreXRestaurantPostgres'
$ProgData    = Join-Path $env:ProgramData 'StoreX Restaurant'
$DataDir     = Join-Path $ProgData 'pgdata'
$LogFile     = Join-Path $ProgData 'logs\uninstall.log'

$PgCtl = Join-Path $InstallDir 'resources\postgres-bin\bin\pg_ctl.exe'

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

Log "Uninstall start (KeepData=$KeepData)"

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -ne 'Stopped') {
        Log "Stopping $ServiceName ..."
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    if (Test-Path $PgCtl) {
        Log "Unregistering service via pg_ctl..."
        & $PgCtl unregister -N $ServiceName 2>&1 | ForEach-Object { Log "  pg_ctl: $_" }
    } else {
        # Fallback: sc.exe delete
        Log 'pg_ctl missing, falling back to sc.exe delete'
        & sc.exe delete $ServiceName 2>&1 | ForEach-Object { Log "  sc: $_" }
    }
} else {
    Log "Service $ServiceName not present, nothing to remove"
}

if ($KeepData -ne 'yes') {
    Log "Deleting data dir $DataDir ..."
    Remove-Item -Recurse -Force $DataDir -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $ProgData 'db.properties') -ErrorAction SilentlyContinue
    Log 'Data deleted.'
} else {
    Log "Keeping data dir at $DataDir"
}

Log 'Done.'
exit 0
