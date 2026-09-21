# Install + register the bundled PostgreSQL as a Windows service for StoreX Restaurant.
# Invoked by the NSIS installer's customInstall hook with $InstallDir as arg 1.
# Idempotent: safe to re-run on upgrade or repair.

param([Parameter(Mandatory=$true)][string]$InstallDir)

$ErrorActionPreference = 'Stop'
$ServiceName = 'StoreXRestaurantPostgres'
# 5440, not the 543x run: this machine can carry stock PostgreSQL installs
# (EDB 16/17/18 take 5432, 5434, 5435 as they are added) plus retail StoreX on
# 5433, and a collision here aborts the install with "port already in use".
$Port        = 5440
$DbUser      = 'lumora'
# Use the maintenance DB that initdb always creates. The bundle ships server-only
# binaries (no psql/createdb), so we can't CREATE DATABASE a fresh one — and we
# don't need to: this is a dedicated single-purpose instance. Flyway builds the
# whole schema here, and V1 creates the uuid-ossp extension itself (the bootstrap
# 'lumora' superuser is allowed to).
$DbName      = 'postgres'

$ProgData    = Join-Path $env:ProgramData 'StoreX Restaurant'
$DataDir     = Join-Path $ProgData 'pgdata'
$ConfigFile  = Join-Path $ProgData 'db.properties'
$LogDir      = Join-Path $ProgData 'logs'
$LogFile     = Join-Path $LogDir 'install.log'

$PgBin       = Join-Path $InstallDir 'resources\postgres-bin\bin'
$Initdb      = Join-Path $PgBin 'initdb.exe'
$PgCtl       = Join-Path $PgBin 'pg_ctl.exe'

New-Item -ItemType Directory -Path $ProgData -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir   -Force | Out-Null

function Log {
    param([string]$msg)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

# Read the service's registered binary path (ImagePath) from the SCM and
# return just the exe — stripped of arguments and surrounding quotes. Returns
# $null if the service doesn't exist. Used to detect a stale registration left
# behind when the installer moves to a new directory: the SCM stores the
# absolute path to pg_ctl.exe at register time, so an "already registered"
# service can be pointing at a folder that no longer exists.
function Get-ServiceExePath {
    param([string]$Name)
    $svc = Get-CimInstance -ClassName Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
    if (-not $svc) { return $null }
    $path = $svc.PathName
    if ([string]::IsNullOrWhiteSpace($path)) { return $null }
    if ($path.StartsWith('"')) {
        $end = $path.IndexOf('"', 1)
        if ($end -gt 1) { return $path.Substring(1, $end - 1) }
    }
    $sp = $path.IndexOf(' ')
    if ($sp -gt 0) { return $path.Substring(0, $sp) }
    return $path
}

# Wrapper for native executables. Avoids two PowerShell 5.1 traps:
#   1. `2>&1` turns benign stderr (e.g. initdb's "trust auth" warning) into
#      ErrorRecords that trip $ErrorActionPreference='Stop' even on exit code 0.
#   2. `Start-Process -ArgumentList @(...)` joins entries with spaces but does
#      NOT quote any element that itself contains spaces (e.g. paths under
#      "Program Files" or "StoreX Restaurant"), splitting them across multiple args.
# We use System.Diagnostics.Process directly with a manually-quoted command
# line, capture both streams via temp files, and return the real exit code.
function Invoke-Native {
    param(
        [Parameter(Mandatory=$true)][string]$Exe,
        [string[]]$Arguments = @(),
        [string]$Label = 'cmd'
    )
    $stdoutFile = [System.IO.Path]::GetTempFileName()
    $stderrFile = [System.IO.Path]::GetTempFileName()
    try {
        $quoted = foreach ($a in $Arguments) {
            if ($a -match '[\s"]') {
                '"' + ($a -replace '"', '\"') + '"'
            } else {
                $a
            }
        }
        $argString = $quoted -join ' '
        $p = Start-Process -FilePath $Exe -ArgumentList $argString `
            -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput $stdoutFile `
            -RedirectStandardError  $stderrFile
        Get-Content $stdoutFile -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_ -ne $null -and $_ -ne '') { Log ('  ' + $Label + ': ' + $_) }
        }
        Get-Content $stderrFile -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_ -ne $null -and $_ -ne '') { Log ('  ' + $Label + '!: ' + $_) }
        }
        return $p.ExitCode
    } finally {
        Remove-Item $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    }
}

try {
    Log '==== StoreX Restaurant PostgreSQL setup ===='
    Log "InstallDir: $InstallDir"
    Log "DataDir:    $DataDir"
    Log "ConfigFile: $ConfigFile"

    if (-not (Test-Path $Initdb)) { throw "Bundled Postgres binaries missing: $Initdb" }
    if (-not (Test-Path $PgCtl))  { throw "Bundled pg_ctl missing: $PgCtl" }

    # If the cluster exists but db.properties is missing, a previous install
    # was interrupted between initdb and credential persistence. We can't
    # recover the password, so wipe and start fresh.
    $clusterExists  = Test-Path (Join-Path $DataDir 'PG_VERSION')
    $credsRecorded  = Test-Path $ConfigFile
    if ($clusterExists -and -not $credsRecorded) {
        Log 'Stale cluster found without saved credentials; wiping for clean reinit'
        # Stop and unregister any leftover service from the previous attempt.
        $stale = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($stale) {
            if ($stale.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
            Invoke-Native -Exe $PgCtl -Label 'pg_ctl' -Arguments @('unregister', '-N', $ServiceName) | Out-Null
        }
        Remove-Item -Recurse -Force $DataDir -ErrorAction SilentlyContinue
        $clusterExists = $false
    }

    if (-not $clusterExists) {
        Log 'Generating database superuser password...'
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $bytes = New-Object byte[] 24
        $rng.GetBytes($bytes)
        $DbPassword = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','x').Replace('/','y')

        # Copy(3)'s backend runs the 'prod' profile, which requires JWT_SECRET with
        # no default. Generate a stable per-install secret here (install runs as
        # admin and can write ProgramData) so sessions survive app restarts and
        # reinstalls-over-kept-data. main.ts only reads it — the interactive user
        # can read db.properties but not rewrite it under the default ACL.
        $jwtBytes = New-Object byte[] 48
        $rng.GetBytes($jwtBytes)
        $JwtSecret = ([System.BitConverter]::ToString($jwtBytes)).Replace('-','').ToLower()

        $pwFile = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($pwFile, $DbPassword, (New-Object System.Text.UTF8Encoding($false)))

        Log 'Initializing PostgreSQL data cluster...'
        $rc = Invoke-Native -Exe $Initdb -Label 'initdb' -Arguments @(
            '-D', $DataDir,
            '-U', $DbUser,
            '--auth-host=md5',
            "--pwfile=$pwFile",
            '-E', 'UTF8',
            '--no-locale'
        )
        Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
        if ($rc -ne 0) { throw "initdb failed (exit $rc)" }

        Log "Configuring postgresql.conf (port=$Port, listen=localhost)..."
        $confPath = Join-Path $DataDir 'postgresql.conf'
        $conf = Get-Content $confPath
        $conf = $conf -replace '^\s*#?\s*port\s*=.*', "port = $Port"
        $conf = $conf -replace "^\s*#?\s*listen_addresses\s*=.*", "listen_addresses = 'localhost'"
        Set-Content -Path $confPath -Value $conf -Encoding ASCII

        Log 'Writing db.properties...'
        @(
            "host=localhost"
            "port=$Port"
            "user=$DbUser"
            "password=$DbPassword"
            "database=$DbName"
            "jwtSecret=$JwtSecret"
        ) | Set-Content -Path $ConfigFile -Encoding ASCII

        # We deliberately leave db.properties with the default ProgramData ACL
        # (Authenticated Users: read; Admins+SYSTEM: full). The app runs as the
        # interactive user and must read the password; locking it to Admins-only
        # would block the very process that needs it. The DB binds to localhost
        # only, so any process with code-exec as the desktop user already has
        # equivalent access to the database itself.
    } elseif ($credsRecorded) {
        Log 'Data dir already initialized; reconciling db.properties'
        # Existing clusters may carry an older db.properties (e.g. database=lumora_pos,
        # or no jwtSecret from a pre-update build). Preserve the superuser password,
        # but force database=postgres and ensure a jwtSecret exists so the launcher's
        # prod-profile backend can boot.
        $props = @{}
        foreach ($line in (Get-Content $ConfigFile -ErrorAction SilentlyContinue)) {
            if ($line -match '^\s*([^#=]+?)\s*=\s*(.+)$') { $props[$Matches[1].Trim()] = $Matches[2].Trim() }
        }
        if (-not $props['password']) { throw "Existing db.properties has no password; wipe $DataDir and reinstall." }
        if (-not $props['jwtSecret']) {
            $rng2 = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            $jb = New-Object byte[] 48
            $rng2.GetBytes($jb)
            $props['jwtSecret'] = ([System.BitConverter]::ToString($jb)).Replace('-','').ToLower()
            Log 'Generated missing jwtSecret'
        }
        @(
            "host=localhost"
            "port=$Port"
            "user=$DbUser"
            "password=$($props['password'])"
            "database=$DbName"
            "jwtSecret=$($props['jwtSecret'])"
        ) | Set-Content -Path $ConfigFile -Encoding ASCII
    }

    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    $needRegister = $true
    if ($existing) {
        $registeredExe = Get-ServiceExePath -Name $ServiceName
        $pgCtlFull = [System.IO.Path]::GetFullPath($PgCtl)
        $matchesCurrent = $registeredExe -and (Test-Path $registeredExe) -and `
            ([System.IO.Path]::GetFullPath($registeredExe) -ieq $pgCtlFull)
        if ($matchesCurrent) {
            Log "Service $ServiceName already registered against current install"
            $needRegister = $false
        } else {
            Log "Service $ServiceName is registered against a stale path: $registeredExe"
            Log "Unregistering stale service so it can be re-registered for $PgCtl"
            if ($existing.Status -ne 'Stopped') {
                Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
            }
            $unregRc = Invoke-Native -Exe $PgCtl -Label 'pg_ctl' `
                -Arguments @('unregister', '-N', $ServiceName)
            if ($unregRc -ne 0 -or (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
                Log "pg_ctl unregister did not remove the service; falling back to sc.exe delete"
                & sc.exe delete $ServiceName | Out-Null
                Start-Sleep -Seconds 2
            }
        }
    }
    if ($needRegister) {
        Log "Registering Windows service $ServiceName ..."
        $rc = Invoke-Native -Exe $PgCtl -Label 'pg_ctl' -Arguments @(
            'register', '-N', $ServiceName, '-D', $DataDir, '-S', 'auto', '-w'
        )
        if ($rc -ne 0) { throw "pg_ctl register failed (exit $rc)" }
    }

    Log "Starting service $ServiceName ..."
    try {
        Start-Service -Name $ServiceName -ErrorAction Stop
    } catch {
        Log "Start-Service failed: $($_.Exception.Message)"
        $pgLogDir = Join-Path $DataDir 'log'
        if (Test-Path $pgLogDir) {
            $latest = Get-ChildItem -Path $pgLogDir -Filter '*.log' -ErrorAction SilentlyContinue |
                      Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($latest) {
                Log "--- Tail of $($latest.FullName) ---"
                Get-Content $latest.FullName -Tail 30 -ErrorAction SilentlyContinue |
                    ForEach-Object { Log "  pg: $_" }
                Log "--- End log tail ---"
            }
        }
        throw
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    while ($sw.Elapsed.TotalSeconds -lt 60) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $iar = $tcp.BeginConnect('127.0.0.1', $Port, $null, $null)
            if ($iar.AsyncWaitHandle.WaitOne(2000) -and $tcp.Connected) {
                $tcp.Close()
                $ready = $true
                break
            }
            $tcp.Close()
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) { throw "Postgres service started but port $Port did not become reachable" }
    Log "Service is accepting connections on port $Port"

    # No CREATE DATABASE / CREATE EXTENSION here: the bundle is server-only (no
    # psql), the app uses the always-present 'postgres' database, and Flyway builds
    # the schema + creates uuid-ossp on first backend boot.
    Log 'Done.'
    exit 0
}
catch {
    Log ('FATAL: ' + $_.Exception.Message)
    Log ($_.ScriptStackTrace)
    exit 1
}
