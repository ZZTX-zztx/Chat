@echo off
chcp 65001 >nul
echo ======================================
echo        Git 一次性推送脚本 master
echo ======================================
echo.
git status
echo.
echo [添加全部文件] git add .
git add .
set "msg=Update"
set /p "msg=输入提交备注(回车默认Update)："
git commit -m "%msg%"
echo.
echo [推送至远程master] git push origin master
git push origin master
echo.
echo ✅ 推送完成
pause