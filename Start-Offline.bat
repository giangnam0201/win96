@echo off
cd /d "%~dp0"
python offline-server.py
if errorlevel 1 pause
