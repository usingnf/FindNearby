@echo off
setlocal DisableDelayedExpansion
set "FIND_NEARBY_API_STOP_PATH=%~f0"
powershell.exe -NoLogo -NoProfile -Command "$parts = [IO.File]::ReadAllText($env:FIND_NEARBY_API_STOP_PATH) -split '(?m)^# -- FindNearby PowerShell --\r?$', 2; & ([scriptblock]::Create($parts[1]))"
set "FIND_NEARBY_EXIT=%errorlevel%"
if not "%FIND_NEARBY_EXIT%"=="0" pause
exit /b %FIND_NEARBY_EXIT%

# -- FindNearby PowerShell --
$ErrorActionPreference = 'Stop'
$mutex = [System.Threading.Mutex]::new($false, 'Local\FindNearbyLauncher')
$ownsMutex = $false
try {
    try {
        $ownsMutex = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
    } catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) { throw 'FindNearby 실행이 진행 중입니다. 잠시 뒤 다시 시도하세요.' }

    $apiProcessIds = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    if ($apiProcessIds.Count -eq 0) {
        Write-Host 'FindNearby API 서버가 이미 종료되어 있습니다.'
        return
    }
    if ($apiProcessIds.Count -ne 1) { throw '8000번 포트의 API 서버를 하나로 식별할 수 없습니다.' }

    $apiProcessId = $apiProcessIds[0]
    $api = Get-CimInstance Win32_Process -Filter "ProcessId = $apiProcessId"
    if ($api.CommandLine -notmatch '\buvicorn\s+server\.FindNearbyApi:app(?:\s|$)') {
        throw '8000번 포트의 프로그램이 FindNearby API 서버로 확인되지 않았습니다.'
    }
    $process = Get-Process -Id $apiProcessId
    Stop-Process -InputObject $process
    if (-not $process.WaitForExit(10000)) { throw 'FindNearby API 서버가 10초 안에 종료되지 않았습니다.' }
    Write-Host 'FindNearby API 서버를 종료했습니다.'
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
