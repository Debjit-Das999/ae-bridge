# Installs claude-bridge.jsx into After Effects' Scripts/Startup folder(s).
# Run this from an elevated (Administrator) PowerShell, since it writes under Program Files.

$ErrorActionPreference = "Stop"

$src = Join-Path $PSScriptRoot "host\claude-bridge.jsx"
if (-not (Test-Path $src)) {
    throw "Could not find $src"
}

$targets = @(
    "C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\Scripts\Startup",
    "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\Startup"
)

$installedAny = $false
foreach ($dir in $targets) {
    if (Test-Path $dir) {
        $dest = Join-Path $dir "claude-bridge.jsx"
        Copy-Item -Path $src -Destination $dest -Force
        Write-Host "Installed to $dest"
        $installedAny = $true
    } else {
        Write-Host "Skipped (folder not found): $dir"
    }
}

if (-not $installedAny) {
    Write-Warning "No AE Scripts/Startup folder found. Edit the `$targets array in this script to point at your AE install."
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "1. In After Effects: Edit > Preferences > General/Scripting & Expressions >" -ForegroundColor Yellow
Write-Host "   enable 'Allow Scripts to Write Files and Access Network'." -ForegroundColor Yellow
Write-Host "2. Restart After Effects."
Write-Host "3. Check %TEMP%\claude-ae-bridge.log for a line like 'claude-bridge initialized (PORT=41890)'."
