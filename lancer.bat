@echo off
rem Lance le serveur local de Pelicane et ouvre le site dans le navigateur.
start "" http://localhost:8080
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serveur.ps1"
