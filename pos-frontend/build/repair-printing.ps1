# "StoreX Restaurant - Repair printing" (Start menu).
#
# Re-runs setup-qz-signing.ps1 as administrator and says what happened in
# plain words. For when printing starts asking for permission again — QZ Tray
# was installed after StoreX, or reinstalled/upgraded and lost the certificate.
# Safe to run any number of times: it keeps this till's key and only re-trusts it.

$ErrorActionPreference = 'Stop'

# Installed as <install dir>\resources\repair-printing.ps1.
$InstallDir = Split-Path $PSScriptRoot -Parent
$Setup = Join-Path $PSScriptRoot 'setup-qz-signing.ps1'
$LogFile = Join-Path $env:ProgramData 'StoreX Restaurant\logs\qz-setup.log'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    # Ask Windows for admin (the usual "Do you want to allow..." prompt) and run again.
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'))
    } catch {
        # Declined the prompt: nothing to do.
    }
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms

function Show-Result {
    param([string]$Text, [System.Windows.Forms.MessageBoxIcon]$Icon)
    [void][System.Windows.Forms.MessageBox]::Show($Text, 'StoreX Restaurant - Repair printing',
        [System.Windows.Forms.MessageBoxButtons]::OK, $Icon)
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Setup -InstallDir $InstallDir | Out-Null
switch ($LASTEXITCODE) {
    0 {
        Show-Result ("Printing is set up.`n`n" +
            "The next time the till prints, QZ Tray asks once to allow StoreX Restaurant: " +
            "tick 'Remember this decision' and click Allow. After that it prints without asking.") `
            ([System.Windows.Forms.MessageBoxIcon]::Information)
    }
    2 {
        Show-Result ("QZ Tray is not installed on this computer.`n`n" +
            "Install QZ Tray (qz.io), then run 'Repair printing' again.") `
            ([System.Windows.Forms.MessageBoxIcon]::Warning)
    }
    default {
        Show-Result ("Printing could not be set up (code $LASTEXITCODE).`n`n" +
            "The till still prints, but QZ Tray will ask for permission each time.`n" +
            "Details: $LogFile") `
            ([System.Windows.Forms.MessageBoxIcon]::Error)
    }
}
