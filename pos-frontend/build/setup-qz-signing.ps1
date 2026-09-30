# Per-machine QZ Tray signing for StoreX Restaurant — silent receipt and kitchen printing.
#
# Unsigned, QZ Tray asks the cashier to allow the site, and will not remember
# the answer. Signed with a certificate QZ trusts, it prints without asking. This:
#
#   1. makes a signing key for THIS machine (once) with the bundled JRE's keytool,
#      in %ProgramData%\StoreX Restaurant\qz\ — the launcher hands it to the backend;
#   2. installs its certificate into QZ Tray as override.crt, so QZ trusts it;
#   3. restarts QZ Tray (as the signed-in user) so it loads the certificate.
#
# Per machine on purpose: a key shared by every install would let anyone who
# unpacked the installer sign print jobs for every customer's QZ Tray.
#
# Invoked by the NSIS installer's customInstall hook (elevated). Also safe to run
# by hand, as administrator, after installing QZ Tray later:
#   powershell -ExecutionPolicy Bypass -File "<install dir>\resources\setup-qz-signing.ps1" -InstallDir "<install dir>"
# Idempotent. Never blocks the install: printing works unsigned without it.
#
# Exit codes: 0 done (or nothing to do), 1 key generation failed,
#             2 QZ Tray not found, 3 could not write to QZ Tray's folder (not admin).

param(
    [Parameter(Mandatory=$true)][string]$InstallDir,
    # QZ Tray's install folder; found automatically when omitted.
    [string]$QzTrayDir = ''
)

$ErrorActionPreference = 'Stop'

$ProgData  = Join-Path $env:ProgramData 'StoreX Restaurant'
$QzData    = Join-Path $ProgData 'qz'
$Keystore  = Join-Path $QzData 'qz-signing.p12'
$CertFile  = Join-Path $QzData 'qz-signing.crt'
$PropsFile = Join-Path $QzData 'qz.properties'
$LogDir    = Join-Path $ProgData 'logs'
$LogFile   = Join-Path $LogDir 'qz-setup.log'
$Keytool   = Join-Path $InstallDir 'resources\jre\bin\keytool.exe'

New-Item -ItemType Directory -Path $QzData -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Log {
    param([string]$msg)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

# Same trap-avoidance as install-postgres.ps1: real exit code, both streams logged,
# arguments with spaces quoted. Nothing secret is ever an argument here.
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
            if ($a -match '[\s"]') { '"' + ($a -replace '"', '\"') + '"' } else { $a }
        }
        $p = Start-Process -FilePath $Exe -ArgumentList ($quoted -join ' ') `
            -Wait -PassThru -NoNewWindow `
            -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
        Get-Content $stdoutFile, $stderrFile -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_) { Log ('  ' + $Label + ': ' + $_) }
        }
        return $p.ExitCode
    } finally {
        Remove-Item $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    }
}

function Read-Props {
    param([string]$Path)
    $props = @{}
    if (Test-Path $Path) {
        foreach ($line in Get-Content $Path) {
            $eq = $line.IndexOf('=')
            if ($eq -gt 0 -and -not $line.TrimStart().StartsWith('#')) {
                $props[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim()
            }
        }
    }
    return $props
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# keytool reads passwords from a file with -storepass:file, keeping them off the
# command line (and out of this log and the process list). Deleted straight after.
function With-PasswordFile {
    param([string]$Password, [scriptblock]$Body)
    $pwFile = [System.IO.Path]::GetTempFileName()
    try {
        Write-Utf8NoBom -Path $pwFile -Text $Password
        & $Body $pwFile
    } finally {
        Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
    }
}

function Find-QzTray {
    if ($QzTrayDir) { return $QzTrayDir }
    $candidates = @()
    foreach ($root in 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                      'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') {
        Get-ItemProperty $root -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like 'QZ Tray*' } |
            ForEach-Object {
                if ($_.InstallLocation) { $candidates += $_.InstallLocation }
                if ($_.UninstallString) { $candidates += (Split-Path ($_.UninstallString.Trim('"')) -Parent) }
            }
    }
    $candidates += (Join-Path $env:ProgramFiles 'QZ Tray')
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'QZ Tray') }
    foreach ($dir in $candidates) {
        if ($dir -and (Test-Path (Join-Path $dir 'qz-tray.jar'))) { return $dir }
    }
    return $null
}

try {
    Log '==== StoreX Restaurant QZ Tray signing setup ===='

    # ── 1. The key ─────────────────────────────────────────────────────────
    $props = Read-Props $PropsFile
    $password = $props['password']
    if (-not (Test-Path $Keystore) -or -not $password) {
        if (-not (Test-Path $Keytool)) { throw "Bundled keytool not found: $Keytool" }
        # A keystore without its password is unusable; start again.
        Remove-Item $Keystore, $CertFile -Force -ErrorAction SilentlyContinue

        $bytes = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','x').Replace('/','y')

        Log "Generating a signing key for $env:COMPUTERNAME..."
        $rc = With-PasswordFile $password {
            param($pwFile)
            Invoke-Native -Exe $Keytool -Label 'keytool' -Arguments @(
                '-genkeypair', '-alias', 'qz', '-keyalg', 'RSA', '-keysize', '2048',
                '-sigalg', 'SHA256withRSA', '-validity', '7300',
                '-dname', "CN=StoreX Restaurant on $env:COMPUTERNAME, O=Lumora Tech Solutions",
                '-storetype', 'PKCS12', '-keystore', $Keystore,
                '-storepass:file', $pwFile, '-keypass:file', $pwFile)
        }
        if ($rc -ne 0 -or -not (Test-Path $Keystore)) { throw "keytool -genkeypair failed (exit $rc)" }

        Write-Utf8NoBom -Path $PropsFile -Text ("# Written by setup-qz-signing.ps1; read by the StoreX Restaurant launcher.`r`n" +
            "keystore=$Keystore`r`npassword=$password`r`n")
        Log "Key written to $Keystore"
    } else {
        Log "Using the existing key at $Keystore"
    }

    # The certificate is public; export it fresh every run.
    $rc = With-PasswordFile $password {
        param($pwFile)
        Invoke-Native -Exe $Keytool -Label 'keytool' -Arguments @(
            '-exportcert', '-rfc', '-alias', 'qz', '-keystore', $Keystore,
            '-storepass:file', $pwFile, '-file', $CertFile)
    }
    if ($rc -ne 0 -or -not (Test-Path $CertFile)) { throw "keytool -exportcert failed (exit $rc)" }

    # ── 2. Trust it in QZ Tray ─────────────────────────────────────────────
    $qz = Find-QzTray
    if (-not $qz) {
        Log 'QZ Tray is not installed. Install it, then run this script again as administrator.'
        exit 2
    }
    $override = Join-Path $qz 'override.crt'
    $wanted = [System.IO.File]::ReadAllText($CertFile)
    $current = if (Test-Path $override) { [System.IO.File]::ReadAllText($override) } else { '' }
    if ($current -eq $wanted) {
        Log "QZ Tray at $qz already trusts this certificate."
        exit 0
    }
    try {
        Copy-Item $CertFile $override -Force
    } catch {
        Log "Could not write $override - run this script as administrator. ($($_.Exception.Message))"
        exit 3
    }
    Log "Installed the certificate as $override"

    # ── 3. Restart QZ Tray so it loads the certificate ─────────────────────
    $running = @(Get-Process -Name javaw, qz-tray -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($qz, [System.StringComparison]::OrdinalIgnoreCase) })
    if ($running.Count -gt 0) {
        Log 'Restarting QZ Tray...'
        $running | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        # Through explorer, so QZ runs as the signed-in user, not elevated like us.
        Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + (Join-Path $qz 'qz-tray.exe') + '"')
    } else {
        Log 'QZ Tray is not running; it picks the certificate up when it next starts.'
    }
    Log 'Done. The first print asks once to allow StoreX Restaurant - tick "Remember this decision".'
    exit 0
} catch {
    Log "FAILED: $($_.Exception.Message)"
    exit 1
}
