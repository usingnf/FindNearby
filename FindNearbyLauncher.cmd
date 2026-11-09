@echo off
setlocal DisableDelayedExpansion
set "FIND_NEARBY_LAUNCHER_PATH=%~f0"
powershell.exe -NoLogo -NoProfile -Command "$parts = [IO.File]::ReadAllText($env:FIND_NEARBY_LAUNCHER_PATH) -split '(?m)^# -- FindNearby PowerShell --\r?$', 2; & ([scriptblock]::Create($parts[1]))"
set "FIND_NEARBY_EXIT=%errorlevel%"
if not "%FIND_NEARBY_EXIT%"=="0" pause
exit /b %FIND_NEARBY_EXIT%

# -- FindNearby PowerShell --
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $env:FIND_NEARBY_LAUNCHER_PATH
$devDir = Join-Path $projectDir 'Dev'
$logDir = Join-Path $projectDir 'Temp'
$webUrl = 'http://127.0.0.1:5173'
$apiUrl = 'http://127.0.0.1:8000'

function Test-FindNearbyApi($BaseUrl) {
    try {
        $status = Invoke-RestMethod -Uri "$BaseUrl/api/status" -TimeoutSec 2
        return ($status.live_ready -is [bool]) -and
            ($status.PSObject.Properties.Name -contains 'facilities') -and
            ($status.PSObject.Properties.Name -contains 'access_points')
    } catch {
        return $false
    }
}

function Test-FindNearbyWeb {
    try {
        $page = Invoke-WebRequest -Uri "$webUrl/" -UseBasicParsing -TimeoutSec 2
        return ($page.StatusCode -eq 200) -and ($page.Content -match '<title>FindNearby\s*\|')
    } catch {
        return $false
    }
}

function Test-LocalPort([int]$Port) {
    $socket = New-Object System.Net.Sockets.TcpClient
    try {
        $socket.Connect('127.0.0.1', $Port)
        return $true
    } catch [System.Net.Sockets.SocketException] {
        return $false
    } finally {
        $socket.Dispose()
    }
}

function Find-Node {
    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($node) { return $node.Source }
    $runtime = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction SilentlyContinue |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if ($runtime) {
        $runtimeNode = Join-Path $runtime.InstallLocation 'dependencies\node\bin\node.exe'
        if (Test-Path -LiteralPath $runtimeNode -PathType Leaf) { return $runtimeNode }
    }
    throw 'Node.js 실행 파일을 찾을 수 없습니다. Node.js를 설치한 뒤 다시 실행하세요.'
}

function Start-FindNearbyService($Name, $Executable, $Arguments, [scriptblock]$Ready) {
    if (-not (Test-Path -LiteralPath $logDir -PathType Container)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
    $errorLog = Join-Path $logDir "로그_FindNearby_$($Name)오류_$stamp.log"
    $outputLog = Join-Path $logDir "로그_FindNearby_$($Name)_$stamp.log"
    $launch = @{
        FilePath = $Executable
        WorkingDirectory = $devDir
        ArgumentList = $Arguments
        WindowStyle = 'Hidden'
        RedirectStandardOutput = $outputLog
        RedirectStandardError = $errorLog
        PassThru = $true
    }
    $process = Start-Process @launch
    $timeout = [System.Diagnostics.Stopwatch]::StartNew()
    do {
        if (& $Ready) { return }
        if ($process.HasExited) { break }
        Start-Sleep -Milliseconds 300
    } while ($timeout.Elapsed.TotalSeconds -lt 25)
    throw "$Name 서버를 시작하지 못했습니다. 로그를 확인하세요. $errorLog"
}

$mutex = [System.Threading.Mutex]::new($false, 'Local\FindNearbyLauncher')
$ownsMutex = $false
try {
    try {
        $ownsMutex = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
    } catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) { throw '다른 FindNearby 실행이 진행 중입니다. 잠시 뒤 다시 시도하세요.' }

    $webReady = Test-FindNearbyWeb
    if (-not ($webReady -and (Test-FindNearbyApi $webUrl))) {
        $apiReady = Test-FindNearbyApi $apiUrl
        if (-not $webReady -and (Test-LocalPort 5173)) { throw '5173 포트를 다른 서비스가 사용 중입니다.' }
        if (-not $apiReady -and (Test-LocalPort 8000)) { throw '8000 포트를 다른 서비스가 사용 중입니다.' }

        $python = Join-Path $devDir '.venv\Scripts\python.exe'
        if (-not $apiReady -and -not (Test-Path -LiteralPath $python -PathType Leaf)) {
            throw 'Dev의 Python 개발 환경을 찾을 수 없습니다. 개발 실행 안내에 따라 설치하세요.'
        }
        if (-not $webReady) {
            $vite = Join-Path $devDir 'node_modules\vite\bin\vite.js'
            if (-not (Test-Path -LiteralPath $vite -PathType Leaf)) {
                throw 'Dev의 웹 의존성을 찾을 수 없습니다. 개발 실행 안내에 따라 설치하세요.'
            }
            $nodePath = Find-Node
        }

        if (-not $apiReady) {
            $apiArgs = @('-m', 'uvicorn', 'server.FindNearbyApi:app', '--host', '127.0.0.1', '--port', '8000', '--no-access-log')
            Start-FindNearbyService 'API' $python $apiArgs { Test-FindNearbyApi $apiUrl }
        }
        if (-not $webReady) {
            $webArgs = @('.\node_modules\vite\bin\vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort')
            Start-FindNearbyService '웹' $nodePath $webArgs { Test-FindNearbyWeb }
        }
        if (-not (Test-FindNearbyApi $webUrl)) {
            throw '웹 화면에서 API 서버에 연결할 수 없습니다. Temp 폴더의 실행 로그를 확인하세요.'
        }
    }

    Write-Host "FindNearby 준비 완료  $webUrl/"
    Start-Process -FilePath "$webUrl/"
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
