# Nous — выпуск новой версии одной командой.
# Использование:  .\release.ps1 0.2.0
# Что делает: поднимает номер версии, собирает установщик, коммитит и ставит git-тег.
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Set-Version($file, $ver) {
  $path = Resolve-Path $file
  $text = [System.IO.File]::ReadAllText($path)
  $re = [regex]'"version"\s*:\s*"[^"]*"'
  $text = $re.Replace($text, '"version": "' + $ver + '"', 1)  # только первое вхождение
  [System.IO.File]::WriteAllText($path, $text)  # UTF-8 без BOM
}

Write-Host "Версия -> $Version" -ForegroundColor Cyan
Set-Version 'package.json' $Version
Set-Version 'src-tauri\tauri.conf.json' $Version

Write-Host "Собираю установщик (пара минут)…" -ForegroundColor Cyan
npx tauri build

git add -A
git commit -m "Release v$Version"
git tag "v$Version"

$exe = "src-tauri\target\release\bundle\nsis\Nous_${Version}_x64-setup.exe"
Write-Host ""
Write-Host "Готово! Осталось два шага:" -ForegroundColor Green
Write-Host "  1) git push; git push --tags"
Write-Host "  2) На GitHub: Releases -> Draft a new release -> тег v$Version ->"
Write-Host "     перетащи установщик и нажми Publish:"
Write-Host "     $exe" -ForegroundColor Yellow
