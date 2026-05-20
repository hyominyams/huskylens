# HUSKYLENS Vision · 자동 설치 스크립트 (Windows PowerShell)
# 사용법:  setup.cmd  (또는)  powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
$RequiredMajor = 20

function Write-Header {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host " HUSKYLENS Vision · Setup" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
}

function Write-Step($Message) {
    Write-Host ""
    Write-Host "▸ $Message" -ForegroundColor Yellow
}

function Get-NodeMajor {
    if (Get-Command node -ErrorAction SilentlyContinue) {
        try {
            return [int]((node -v).TrimStart('v').Split('.')[0])
        } catch {
            return 0
        }
    }
    return 0
}

function Reload-Path {
    $env:Path = `
        [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + `
        [System.Environment]::GetEnvironmentVariable("Path", "Machine")
}

function Ensure-Node {
    $current = Get-NodeMajor
    if ($current -ge $RequiredMajor) {
        Write-Host "✓ Node.js $(node -v) 확인됨" -ForegroundColor Green
        return
    }

    Write-Step "Node.js $RequiredMajor+ 가 없습니다. fnm 으로 자동 설치합니다."

    if (-not (Get-Command fnm -ErrorAction SilentlyContinue)) {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Write-Host "  · winget 으로 fnm 설치 중..."
            winget install --id Schniz.fnm --silent `
                --accept-source-agreements --accept-package-agreements | Out-Null
            Reload-Path
        } else {
            Write-Host ""
            Write-Host "✗ winget 이 없어 자동 설치할 수 없습니다." -ForegroundColor Red
            Write-Host "  → https://nodejs.org/ 에서 Node.js LTS 를 직접 설치한 뒤 이 스크립트를 다시 실행하세요."
            exit 1
        }
    }

    if (-not (Get-Command fnm -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "✗ fnm 자동 설치 실패." -ForegroundColor Red
        Write-Host "  → https://nodejs.org/ 에서 Node.js LTS 를 직접 설치한 뒤 이 스크립트를 다시 실행하세요."
        exit 1
    }

    Write-Host "  · Node.js $RequiredMajor 설치 중..."
    fnm install $RequiredMajor | Out-Null
    fnm use $RequiredMajor | Out-Null
    fnm default $RequiredMajor 2>$null | Out-Null

    # 현재 세션에 fnm 활성화
    fnm env --use-on-cd | Out-String | Invoke-Expression
    Reload-Path

    Write-Host "✓ Node.js $(node -v) 설치 완료" -ForegroundColor Green
}

Write-Header
Ensure-Node

Write-Step "프로젝트 의존성 설치 (npm install)..."
npm install --no-fund --no-audit

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Step ".env 파일을 생성했습니다."
    Write-Host "  → 메모장으로 .env 를 열어 OPENAI_API_KEY=sk-... 를 채워주세요."
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " ✓ 설치 완료" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host " 다음 단계:"
Write-Host "   1. .env 파일을 열어 OPENAI_API_KEY 를 채웁니다."
Write-Host "   2. 실행:  npm start"
Write-Host "   3. 브라우저:  http://localhost:5173"
Write-Host ""
