Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

$scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
$scriptDir = Split-Path -Parent $scriptPath
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

function Exit-WithCode {
  param([int]$Code)
  exit $Code
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "ts-dev-cli bootstrap failed: node is not available."
  Exit-WithCode 86
}

function Resolve-DefaultCacheRoot {
  if ($env:GROBOT_TS_DEV_CLI_CACHE_ROOT) {
    return $env:GROBOT_TS_DEV_CLI_CACHE_ROOT
  }
  if ($env:GROBOT_TS_DEV_CACHE_ROOT) {
    return (Join-Path $env:GROBOT_TS_DEV_CACHE_ROOT "ts-dev-cli")
  }
  $localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { (Join-Path $HOME "AppData\Local") }
  return (Join-Path $localAppData "grobot\ts-dev-cli")
}

function Test-SourceNewerThanEntry {
  param(
    [string]$SourceRoot,
    [string]$EntryPath
  )
  if (-not (Test-Path $EntryPath)) {
    return $true
  }
  $entry = Get-Item $EntryPath
  if ((Test-Path (Join-Path $SourceRoot "gateway\tsconfig.json")) -and
      ((Get-Item (Join-Path $SourceRoot "gateway\tsconfig.json")).LastWriteTimeUtc -gt $entry.LastWriteTimeUtc)) {
    return $true
  }
  $newer = Get-ChildItem (Join-Path $SourceRoot "gateway\src") -Recurse -File -Include "*.ts","*.tsx","*.d.ts" |
    Where-Object { $_.LastWriteTimeUtc -gt $entry.LastWriteTimeUtc } |
    Select-Object -First 1
  return $null -ne $newer
}

$cacheRoot = Resolve-DefaultCacheRoot
$outDir = if ($env:GROBOT_TS_DEV_CLI_OUT_DIR) { $env:GROBOT_TS_DEV_CLI_OUT_DIR } else { Join-Path $cacheRoot "dist" }
$entry = Join-Path $outDir "cli\main.js"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (Test-SourceNewerThanEntry -SourceRoot $repoRoot -EntryPath $entry) {
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Error "ts-dev-cli bootstrap failed: npx is not available."
    Exit-WithCode 86
  }
  & npx --yes --package typescript@5.6.3 tsc --project (Join-Path $repoRoot "gateway\tsconfig.json") --outDir $outDir --pretty false
  if ($LASTEXITCODE -ne 0) {
    Start-Sleep -Milliseconds 200
    & npx --yes --package typescript@5.6.3 tsc --project (Join-Path $repoRoot "gateway\tsconfig.json") --outDir $outDir --pretty false
    if ($LASTEXITCODE -ne 0) {
      Write-Error "ts-dev-cli bootstrap failed: TypeScript compile error (see diagnostics above)."
      Exit-WithCode 86
    }
  }
}

if (-not (Test-Path $entry)) {
  Write-Error "ts-dev-cli bootstrap failed: missing compiled entry $entry"
  Exit-WithCode 86
}

$env:GROBOT_TS_DEV_REPO_ROOT = $repoRoot
& node $entry @args
exit $LASTEXITCODE
