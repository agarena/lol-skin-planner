# Elevated LCU credential probe (TCLS / WeGame client)
# The Chinese client often leaves lockfile empty; credentials live in LeagueClientUx.exe command line,
# which only an elevated process can read.
$ErrorActionPreference = 'Continue'
$out = 'C:\Users\38221\Desktop\myprojects\英雄联盟自动化\tools\.lcu-conn.json'

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Depth 4
  [IO.File]::WriteAllText($out, $json, (New-Object Text.UTF8Encoding($false)))
}

try {
  $procs = Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'"
  if (-not $procs) {
    Write-Result @{ ok = $false; error = 'LeagueClientUx.exe not running'; at = (Get-Date).ToString('o') }
    exit
  }
  $cl = ($procs | Select-Object -First 1).CommandLine
  if (-not $cl) {
    Write-Result @{ ok = $false; error = 'command line unreadable even when elevated'; at = (Get-Date).ToString('o') }
    exit
  }
  $port = [regex]::Match($cl, '--app-port=(\d+)').Groups[1].Value
  $token = [regex]::Match($cl, '--remoting-auth-token=([\w\-]+)').Groups[1].Value
  $install = [regex]::Match($cl, '--install-directory=("?)([^"]+)\1').Groups[2].Value
  if (-not $port -or -not $token) {
    Write-Result @{ ok = $false; error = 'port/token not found in command line'; cmdline = $cl; at = (Get-Date).ToString('o') }
    exit
  }
  Write-Result @{
    ok      = $true
    port    = [int]$port
    token   = $token
    install = $install
    pid     = ($procs | Select-Object -First 1).ProcessId
    at      = (Get-Date).ToString('o')
  }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message; at = (Get-Date).ToString('o') }
}
