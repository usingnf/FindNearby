@echo off
setlocal DisableDelayedExpansion
pushd "%~dp0" || exit /b 1

if not exist ".env" (
    echo Missing .env. Extract all files from the FindNearby ZIP.
    goto failed
)

set "FIND_NEARBY_PYTHON=.venv\Scripts\python.exe"
if exist "%FIND_NEARBY_PYTHON%" goto dependencies

where py >nul 2>&1
if errorlevel 1 goto python_fallback
for %%V in (3.15 3.14 3.12) do (
    py -%%V --version >nul 2>&1
    if not errorlevel 1 (
        py -%%V -m venv .venv
        if errorlevel 1 goto failed
        goto dependencies
    )
)

:python_fallback
python -c "import sys; sys.exit(sys.version_info[:2] not in ((3, 12), (3, 14), (3, 15)))" >nul 2>&1
if errorlevel 1 (
    echo Python 3.15, 3.14, or 3.12 is required. See the installation guide.
    goto failed
)
python -m venv .venv
if errorlevel 1 goto failed

:dependencies
if not exist ".venv\findnearby-0.1.1-test-installed" (
    "%FIND_NEARBY_PYTHON%" -m pip install --disable-pip-version-check -r requirements.txt
    if errorlevel 1 goto failed
    type nul >".venv\findnearby-0.1.1-test-installed"
    if errorlevel 1 goto failed
)

if not exist "facilities.sqlite3" (
    "%FIND_NEARBY_PYTHON%" -m server.DeploymentData seed
    if errorlevel 1 goto failed
)

if not defined UVICORN_PORT set "UVICORN_PORT=5173"
echo Open http://127.0.0.1:%UVICORN_PORT%/ in your browser once the server starts.
"%FIND_NEARBY_PYTHON%" -m uvicorn server.FindNearbyDeployment:create_deployment --factory --host 127.0.0.1 --workers 1 --no-access-log --no-proxy-headers
if errorlevel 1 goto failed
popd
exit /b 0

:failed
echo FindNearby could not start. Review the message above and the installation guide.
popd
pause
exit /b 1
