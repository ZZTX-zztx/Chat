@echo off
chcp 65001 >nul
echo ==============================================
echo           Git 一键提交推送脚本
echo ==============================================
echo.

:: 查看当前变更
echo [1/5] 查看文件状态
git status
echo.

:: 添加所有变更
echo [2/5] git add .
git add .
if %errorlevel% neq 0 (
    echo 错误：git add 失败！
    pause
    exit /b %errorlevel%
)
echo.

:: 输入提交备注
set "msg=Update"
set /p "msg=请输入提交备注(直接回车默认Update): "
echo [3/5] git commit -m "%msg%"
git commit -m "%msg%"
if %errorlevel% neq 0 (
    echo 提示：无文件变更无需提交，继续推送
)
echo.

:: 先拉取远程代码防止冲突
echo [4/5] git pull origin main
git pull origin main --rebase
if %errorlevel% neq 0 (
    echo 错误：拉取代码失败，存在冲突或网络问题！
    pause
    exit /b %errorlevel%
)
echo.

:: 推送到远程main分支
echo [5/5] git push origin main
git push origin main
if %errorlevel% neq 0 (
    echo 错误：推送失败！
    pause
    exit /b %errorlevel%
)

echo.
echo ==============================================
echo ✅ 全部操作完成，推送成功！
echo ==============================================
pause