# "StoreX Restaurant - Set super-admin password" (Start menu).
#
# Sets the Lumora support (super-admin) login on this till: for installs set up
# before the setup wizard asked for one, or when the password is lost. Runs as a
# Windows administrator — whoever controls this PC's administrator account can
# set it; nobody can from a browser.
#
# It reads the database credentials from db.properties and runs
# com.lumora.pos.superadmin.tools.SetSuperAdminPassword out of the installed
# backend jar with the bundled Java. The password travels by environment
# variable, never on a command line. The running app picks it up immediately.

param(
    # For testing against another database; normally found automatically.
    [string]$ConfigFile = (Join-Path $env:ProgramData 'StoreX Restaurant\db.properties'),
    [string]$Resources = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'))
    } catch {
        # Declined the prompt: nothing to do.
    }
    exit 0
}

$Host.UI.RawUI.WindowTitle = 'StoreX Restaurant - Set super-admin password'
$java = Join-Path $Resources 'jre\bin\java.exe'
$jar = Join-Path $Resources 'backend\pos-backend.jar'

function Finish([int]$code) {
    Write-Host ''
    Read-Host 'Press Enter to close' | Out-Null
    exit $code
}

function Read-Props([string]$Path) {
    $props = @{}
    foreach ($line in Get-Content $Path) {
        $eq = $line.IndexOf('=')
        if ($eq -gt 0 -and -not $line.TrimStart().StartsWith('#')) {
            $props[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim()
        }
    }
    return $props
}

function Read-Plain([string]$prompt) {
    $secure = Read-Host -Prompt $prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host 'StoreX Restaurant - Set the Lumora support (super-admin) login' -ForegroundColor Cyan
Write-Host ''
foreach ($f in $ConfigFile, $java, $jar) {
    if (-not (Test-Path $f)) { Write-Host "Not found: $f - is StoreX Restaurant installed?" -ForegroundColor Red; Finish 1 }
}
$db = Read-Props $ConfigFile

$email = Read-Host 'Super-admin email [superadmin@lumora.com]'
if ([string]::IsNullOrWhiteSpace($email)) { $email = 'superadmin@lumora.com' }
$password = Read-Plain 'New password (at least 8 characters)'
$again = Read-Plain 'Type it again'
if ($password -ne $again) { Write-Host 'The passwords do not match. Nothing was changed.' -ForegroundColor Red; Finish 2 }

$env:DB_URL = "jdbc:postgresql://$($db['host']):$($db['port'])/$($db['database'])"
$env:DB_USER = $db['user']
$env:DB_PASSWORD = $db['password']
$env:SUPERADMIN_EMAIL = $email
$env:SUPERADMIN_PASSWORD = $password
try {
    & $java -cp $jar '-Dloader.main=com.lumora.pos.superadmin.tools.SetSuperAdminPassword' `
        'org.springframework.boot.loader.launch.PropertiesLauncher'
    $code = $LASTEXITCODE
} finally {
    foreach ($v in 'DB_URL', 'DB_USER', 'DB_PASSWORD', 'SUPERADMIN_EMAIL', 'SUPERADMIN_PASSWORD') {
        Remove-Item "Env:\$v" -ErrorAction SilentlyContinue
    }
    $password = $null; $again = $null
}

if ($code -eq 0) {
    Write-Host ''
    Write-Host "Done. Sign in to the super-admin console as $email." -ForegroundColor Green
} else {
    Write-Host 'Nothing was changed.' -ForegroundColor Red
}
Finish $code
