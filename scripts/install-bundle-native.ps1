Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Show-Usage {
  @"
Usage: .\grobot.ps1 install [options]

Install a portable Grobot native bundle for the current user.

Options:
  --version <tag>       Installed version name (default: bundle VERSION file)
  --force               Reinstall even if the version already exists
  --keep <n>            Keep latest n installed versions (default: 3)
  --bin-dir <dir>       Command shim dir (default: ~/.local/bin)
  --install-root <dir>  Version store root (default: %LOCALAPPDATA%\grobot)
  -h, --help            Show help
"@ | Write-Output
}

function Read-VersionFile {
  param([string]$Path)
  if (Test-Path $Path) {
    return ((Get-Content -Raw $Path).Trim())
  }
  return ""
}

function Ensure-PositiveInteger {
  param([string]$Value)
  return $Value -match '^[0-9]+$' -and [int]$Value -ge 1
}

function Remove-OldVersions {
  param(
    [string]$VersionsDir,
    [int]$KeepCount,
    [string]$ActiveDir
  )
  if (-not (Test-Path $VersionsDir)) {
    return
  }
  $seen = 0
  $deleted = 0
  Get-ChildItem $VersionsDir -Directory | Sort-Object LastWriteTimeUtc -Descending | ForEach-Object {
    $seen += 1
    if ($seen -le $KeepCount) {
      return
    }
    if ($_.FullName -eq $ActiveDir) {
      return
    }
    Remove-Item -Recurse -Force $_.FullName
    $deleted += 1
  }
  if ($deleted -gt 0) {
    Write-Output "cleaned old versions: $deleted"
  }
}

$scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
$scriptDir = Split-Path -Parent $scriptPath
$appRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$bundleRoot = if ($env:GROBOT_BUNDLE_ROOT) {
  $env:GROBOT_BUNDLE_ROOT
} elseif ((Split-Path -Leaf $appRoot) -eq "app") {
  (Resolve-Path (Join-Path $appRoot "..")).Path
} else {
  $appRoot
}

$version = Read-VersionFile (Join-Path $bundleRoot "VERSION")
if (-not $version) {
  $version = Read-VersionFile (Join-Path $appRoot "VERSION")
}
if (-not $version) {
  $version = "v0.1.0-portable"
}

$forceInstall = $false
$keepVersions = if ($env:GROBOT_KEEP_VERSIONS) { $env:GROBOT_KEEP_VERSIONS } else { "3" }
$binDir = if ($env:GROBOT_BIN_DIR) { $env:GROBOT_BIN_DIR } else { Join-Path $HOME ".local\bin" }
$installRoot = if ($env:GROBOT_INSTALL_ROOT) {
  $env:GROBOT_INSTALL_ROOT
} elseif ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA "grobot"
} else {
  Join-Path $HOME ".local\share\grobot"
}

$index = 0
while ($index -lt $args.Count) {
  $arg = $args[$index]
  switch ($arg) {
    "--version" {
      if ($index + 1 -ge $args.Count) { throw "missing value for --version" }
      $version = $args[$index + 1]
      $index += 2
    }
    "--force" {
      $forceInstall = $true
      $index += 1
    }
    "--keep" {
      if ($index + 1 -ge $args.Count) { throw "missing value for --keep" }
      $keepVersions = $args[$index + 1]
      $index += 2
    }
    "--bin-dir" {
      if ($index + 1 -ge $args.Count) { throw "missing value for --bin-dir" }
      $binDir = $args[$index + 1]
      $index += 2
    }
    "--install-root" {
      if ($index + 1 -ge $args.Count) { throw "missing value for --install-root" }
      $installRoot = $args[$index + 1]
      $index += 2
    }
    { $_ -eq "-h" -or $_ -eq "--help" } {
      Show-Usage
      exit 0
    }
    default {
      throw "unknown option: $arg"
    }
  }
}

if (-not (Ensure-PositiveInteger $keepVersions)) {
  throw "invalid --keep value: $keepVersions (must be integer >= 1)"
}

$bundleExe = Join-Path $bundleRoot "grobot.exe"
if (-not (Test-Path $bundleExe)) {
  throw "bundle launcher not found: $bundleExe"
}
$runner = Join-Path $appRoot "scripts\run-ts-dev-cli.ps1"
if (-not (Test-Path $runner)) {
  throw "bundle app is incomplete: missing app\scripts\run-ts-dev-cli.ps1"
}

$versionsDir = Join-Path $installRoot "versions"
$targetDir = Join-Path $versionsDir $version
$activeCmd = Join-Path $binDir "grobot.cmd"

New-Item -ItemType Directory -Force -Path $versionsDir | Out-Null
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

if ((Test-Path $targetDir) -and -not $forceInstall) {
  "@echo off`r`nset GROBOT_SOURCE_ROOT=$targetDir\app`r`n""$targetDir\grobot.exe"" %*`r`n" |
    Set-Content -NoNewline -Encoding ASCII $activeCmd
  Remove-OldVersions -VersionsDir $versionsDir -KeepCount ([int]$keepVersions) -ActiveDir $targetDir
  Write-Output "Grobot successfully installed!"
  Write-Output ""
  Write-Output "  Version: $version"
  Write-Output "  Location: $activeCmd"
  exit 0
}

$tmpTarget = "$targetDir.tmp.$PID"
if (Test-Path $tmpTarget) {
  Remove-Item -Recurse -Force $tmpTarget
}
New-Item -ItemType Directory -Force -Path $tmpTarget | Out-Null
Copy-Item $bundleExe (Join-Path $tmpTarget "grobot.exe")
Copy-Item -Recurse $appRoot (Join-Path $tmpTarget "app")

if (Test-Path $targetDir) {
  Remove-Item -Recurse -Force $targetDir
}
Move-Item $tmpTarget $targetDir
"@echo off`r`nset GROBOT_SOURCE_ROOT=$targetDir\app`r`n""$targetDir\grobot.exe"" %*`r`n" |
  Set-Content -NoNewline -Encoding ASCII $activeCmd
Remove-OldVersions -VersionsDir $versionsDir -KeepCount ([int]$keepVersions) -ActiveDir $targetDir

Write-Output "Grobot successfully installed!"
Write-Output ""
Write-Output "  Version: $version"
Write-Output "  Location: $activeCmd"

$pathParts = ($env:PATH -split ';') | Where-Object { $_ }
if ($pathParts -notcontains $binDir) {
  Write-Output ""
  Write-Output "PATH hint:"
  Write-Output "  [Environment]::SetEnvironmentVariable('Path', `$env:Path + ';$binDir', 'User')"
}
