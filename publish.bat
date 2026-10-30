@echo off
rem Publishes tport-cloud-mcp to npm (npx -y tport-cloud-mcp). npm may ask for the sign-in or a one-time code.
cd /d "%~dp0"
call git pull || goto :fail
call npm ci || goto :fail
call npm test || goto :fail
call npm run build || goto :fail
call npm whoami >nul 2>&1 || call npm login || goto :fail
call npm publish --access public || goto :fail
echo.
echo Published. Check: npm view tport-cloud-mcp version
pause
exit /b 0
:fail
echo Publish stopped, see the message above.
pause
exit /b 1
