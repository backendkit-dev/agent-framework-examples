<#
.SYNOPSIS
  Carga archivos historicos de auditoria (NO-GO) al Reflection Engine.
.DESCRIPTION
  Escanea ~/.deepseek-code/projects/{hash}/audits/ en busca de archivos .md
  con veredicto NO-GO o NO-GO condicional, extrae los hallazgos y los
  persiste en failures.json, luego dispara reflect() para detectar patrones
  y promover policyRules.

  Por defecto solo procesa el proyecto actual. Usa -AllProjects para
  escanear todos los proyectos.

.PARAMETER AllProjects
  Escanea todos los proyectos en ~/.deepseek-code/projects/
.PARAMETER Force
  Recarga registros aunque ya existan (evita dedup por fingerprint)
.PARAMETER DryRun
  Solo muestra que archivos se procesarian sin persistir nada
.EXAMPLE
  pwsh scripts/load-history.ps1
  Carga historicos del proyecto actual

  pwsh scripts/load-history.ps1 -AllProjects
  Carga historicos de todos los proyectos

  pwsh scripts/load-history.ps1 -DryRun
  Muestra que se procesaria sin escribir
#>

param(
  [switch]$AllProjects,
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Get-Location).Path

Write-Host "=== Historical Loader ===" -ForegroundColor Cyan
Write-Host "Proyecto actual: $ProjectRoot" -ForegroundColor Gray
if ($AllProjects) { Write-Host "Modo: Todos los proyectos" -ForegroundColor Yellow }
if ($Force) { Write-Host "Modo: Forzar recarga" -ForegroundColor Yellow }
if ($DryRun) { Write-Host "Modo: Dry run (solo lectura)" -ForegroundColor Yellow }
Write-Host ""

# --- Dry run: solo listar archivos ---
if ($DryRun) {
  Write-Host "=== DRY RUN ===" -ForegroundColor Yellow
  Write-Host "Se escanearian los siguientes directorios:" -ForegroundColor Gray

  $projectsDir = Join-Path $env:USERPROFILE ".deepseek-code" "projects"
  if ($AllProjects) {
    Get-ChildItem -Path $projectsDir -Directory | ForEach-Object {
      $auditsDir = Join-Path $_.FullName "audits"
      if (Test-Path $auditsDir) {
        $files = Get-ChildItem -Path $auditsDir -Filter "*.md" | Where-Object {
          $_.Name -notlike "auto-gates*" -and
          $_.Name -notlike "pending-issues*" -and
          $_.Name -ne "lecciones-aprendidas.md"
        }
        Write-Host "  [$($_.Name)] $($files.Count) archivos" -ForegroundColor Gray
      }
    }
  } else {
    $auditsDir = Join-Path $projectsDir (Get-Item $ProjectRoot).Name.Replace(":", "--").Replace("\", "-") "audits"
    if (Test-Path $auditsDir) {
      $files = Get-ChildItem -Path $auditsDir -Filter "*.md" | Where-Object {
        $_.Name -notlike "auto-gates*" -and
        $_.Name -notlike "pending-issues*" -and
        $_.Name -ne "lecciones-aprendidas.md"
      }
      Write-Host "  $($files.Count) archivos en $auditsDir" -ForegroundColor Gray
    } else {
      Write-Host "  No se encontro directorio audits/" -ForegroundColor Red
    }
  }

  Write-Host ""
  Write-Host "Usa -Force para recargar registros existentes" -ForegroundColor Gray
  Write-Host "Omite -DryRun para ejecutar la carga" -ForegroundColor Gray
  return
}

# --- Generar script temporal ---
$tmpFile = Join-Path $env:TEMP "load-history-runner-$([System.IO.Path]::GetRandomFileName()).ts"

$projectRootEscaped = $ProjectRoot -replace '\\', '\\'

$tsCode = @"
import { HistoricalLoader } from './src/reflection/historical-loader';
import { ReflectionEngine } from './src/reflection/reflection-engine';

async function main() {
  const engine = new ReflectionEngine({ projectRoot: '$projectRootEscaped' });
  await engine.initialize();

  const loader = new HistoricalLoader({ engine, projectRoot: '$projectRootEscaped' });
  const result = await loader.loadAll({
    onlyCurrentProject: $(if ($AllProjects) { 'false' } else { 'true' }),
    force: $(if ($Force) { 'true' } else { 'false' }),
  });

  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
"@

# Escapar backticks y $ para evitar interpolacion de PowerShell
$tsCode = $tsCode -replace '`', '``' -replace '\$', '`$'

# Inicializar variables compartidas entre try/catch/finally
$output = $null
$exitCode = $null

try {
  # Escribir archivo temporal
  Set-Content -Path $tmpFile -Value $tsCode -Encoding UTF8 -NoNewline

  Write-Host "Ejecutando carga historica..." -ForegroundColor Cyan

  # Ejecutar con npx ts-node
  $output = & npx ts-node --project tsconfig.json $tmpFile 2>&1
  $exitCode = $LASTEXITCODE

  if ($exitCode -ne 0) {
    Write-Host "Error ejecutando el cargador (exit code: $exitCode)" -ForegroundColor Red
    Write-Host $output -ForegroundColor Red
    exit 1
  }

  # Parsear resultado - tomar solo la ultima linea que sea JSON valido
  $jsonLine = $output | Select-Object -Last 1
  $data = $jsonLine | ConvertFrom-Json

  Write-Host ""
  Write-Host "=== Resultado ===" -ForegroundColor Green
  Write-Host "Proyectos procesados: $($data.projectsProcessed -join ', ')" -ForegroundColor Cyan
  Write-Host "Archivos escaneados: $($data.scannedFiles)" -ForegroundColor Gray
  Write-Host "Archivos NO-GO: $($data.noGoFiles)" -ForegroundColor Yellow
  Write-Host "Registros cargados: $($data.loaded)" -ForegroundColor Green
  Write-Host "Registros omitidos (dup): $($data.skipped)" -ForegroundColor Gray
  Write-Host "Patrones detectados: $($data.patterns)" -ForegroundColor Cyan
  Write-Host "Reglas promovidas: $($data.promotedRules)" -ForegroundColor Magenta

  if ($data.errors.Length -gt 0) {
    Write-Host ""
    Write-Host "Errores:" -ForegroundColor Red
    $data.errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  }
} catch {
  Write-Host "Error inesperado: $_" -ForegroundColor Red
  if ($output) {
    Write-Host "Salida cruda:" -ForegroundColor Gray
    Write-Host $output
  }
} finally {
  # Limpiar archivo temporal
  if (Test-Path $tmpFile) {
    Remove-Item $tmpFile -Force
  }
}
