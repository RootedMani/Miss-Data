@echo off
REM Sets up a virtual environment and installs Miss Data on Windows.

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python not found. Please install Python 3.9+ from python.org and try again.
    exit /b 1
)

echo Creating virtual environment (.venv)...
python -m venv .venv

echo Installing dependencies...
.venv\Scripts\pip install --upgrade pip >nul
.venv\Scripts\pip install -e .

echo.
echo Done. To start Miss Data, run:
echo.
echo     .venv\Scripts\activate
echo     missdata
echo.
echo Or without activating the venv:
echo.
echo     .venv\Scripts\missdata.exe
echo.
