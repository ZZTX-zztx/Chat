@echo off
chcp 65001 >nul
echo ======================================
echo         Git 一次性完整推送脚本
echo         分支：master
echo ======================================
echo.

echo 1. 查看当前文件变更
git status
echo.

echo 2. 添加所有修改文件
git add .
if %errorlevel% neq 0 (
    echo 错误：git add 执行失败！
    pause
    exit /b %errorlevel%
)
echo.

:: 自定义提交备注，回车默认Update
set "commit_msg=Update"
set /p "commit_msg=请输入本次更新备注(直接回车默认Update)："
echo 3. 提交代码，备注：%commit_msg%
git commit -m "%commit_msg%"
:: 无文件变更时commit会报错，不阻断推送流程
echo.

echo 4. 拉取远程最新代码避免冲突
git pull origin master --rebase
if %errorlevel% neq 0 (
    echo 警告：拉取代码出现冲突，请手动解决后再运行脚本推送！
    pause
    exit /b %errorlevel%
)
echo.

echo 5. 推送本地master到远程origin
git push origin master
if %errorlevel% neq 0 (
    echo 错误：推送失败！
    pause
    exit /b %errorlevel%
)

echo.
echo ======================================
echo ✅ 全部流程执行完毕，代码推送成功！
echo ======================================
pause