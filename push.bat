@echo off
chcp 65001 >nul
echo 校验package.json格式
node -e "console.log(require('./package.json'))"
if %errorlevel% neq 0 (
    echo package.json JSON格式错误，请先删除冲突标记！
    pause
    exit /b
)
echo.
echo 生成package-lock.json
npm install
echo.
git add package.json package-lock.json .gitignore
git commit -m "修复package.json合并冲突，生成lock文件修复CI构建"
git push origin master
echo.
echo ✅ 修复推送完成，重新触发部署即可正常构建
pause