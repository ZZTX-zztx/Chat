@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo ========================================
echo   Backend Deploy Script
echo   Current Dir: %cd%
echo ========================================
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Not inside a Git repository.
    echo         Please run: git init
    echo         then add remote: git remote add origin ^<url^>
    pause
    exit /b 1
)

set REMOTE_URL=
for /f "usebackq delims=" %%i in (`git remote get-url origin`) do set REMOTE_URL=%%i
if "%REMOTE_URL%"=="" (
    echo [ERROR] Remote 'origin' not configured.
    echo         Run: git remote add origin ^<url^>
    pause
    exit /b 1
)
echo [INFO] Remote: %REMOTE_URL%

set CUR_BRANCH=
for /f "usebackq delims=" %%i in (`git branch --show-current`) do set CUR_BRANCH=%%i
if "%CUR_BRANCH%"=="" set CUR_BRANCH=master
echo [INFO] Branch: %CUR_BRANCH%
echo.

set HAS_CHANGES=0
for /f "usebackq delims=" %%i in (`git status --porcelain`) do set HAS_CHANGES=1
if %HAS_CHANGES%==0 (
    echo [SKIP] No changes detected. Nothing to commit.
    echo.
    pause
    exit /b 0
)

echo [INFO] Changes detected:
git status --short
echo.

echo [1/3] git add . ...
git add .
if errorlevel 1 (
    echo [ERROR] git add failed!
    pause
    exit /b 1
)
echo       OK.
echo.

set TMP_COMMIT_MSG_FILE=%TEMP%\git_commit_msg_%RANDOM%.txt
powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss' | Out-File -Encoding ASCII -FilePath '%TMP_COMMIT_MSG_FILE%'"
set /p TS=<%TMP_COMMIT_MSG_FILE%
del "%TMP_COMMIT_MSG_FILE%"
set COMMIT_MSG=Update %TS%

echo [2/3] git commit -m "%COMMIT_MSG%" ...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo [ERROR] git commit failed!
    pause
    exit /b 1
)
echo       OK.
echo.

echo [3/3] git push origin %CUR_BRANCH% ...
git push origin %CUR_BRANCH%
set PUSH_ERR=%errorlevel%

if %PUSH_ERR% neq 0 (
    echo.
    echo [ERROR] git push failed (exit code %PUSH_ERR%).
    echo.
    echo   Common causes and solutions:
    echo   - Remote has newer commits:   git pull --rebase origin %CUR_BRANCH%
    echo   - No push permission:         check GitHub/GitLab SSH key or token
    echo   - Network issue:              check internet or proxy settings
    echo.
    pause
    exit /b %PUSH_ERR%
)

echo       OK.
echo.
echo ========================================
echo   Done! Push successful.
echo ========================================
echo.
pause
endlocal
