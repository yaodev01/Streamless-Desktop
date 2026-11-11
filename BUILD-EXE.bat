@echo off
echo Installing dependencies (needs internet, about 2-5 minutes)...
call npm install
if errorlevel 1 goto fail
echo Building the Windows app...
call npm run dist
if errorlevel 1 goto fail
echo.
echo Done. Your .exe files are in the "dist" folder.
pause
exit /b
:fail
echo Build failed. Make sure Node.js is installed from nodejs.org
pause
