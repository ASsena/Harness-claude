<#
.SYNOPSIS
  Registra o tempo de cada fase do pipeline-agent num CSV no computador do dev.

.DESCRIPTION
  O relógio é o do sistema, não o do modelo: os agentes chamam este script no
  início e no fim de cada fase, e é ele que carimba a hora e calcula a duração.

  Fases abertas ficam em <WorkDir>\.fases\<fase>.txt (uma por arquivo, então
  fases aninhadas e retomadas funcionam). Cada fase fechada vira uma linha no CSV.

  Compatível com Windows PowerShell 5.1 e PowerShell 7.

.EXAMPLE
  log-fase.ps1 -Acao inicio -WorkDir tmp\pipeline\wi-3224 -Fase pipeline -Wi 3224
  log-fase.ps1 -Acao inicio -WorkDir tmp\pipeline\wi-3224 -Fase portao-plano -Tipo espera
  log-fase.ps1 -Acao fim    -WorkDir tmp\pipeline\wi-3224 -Fase portao-plano -Nota "aprovado"
  log-fase.ps1 -Acao fechar-abertas -WorkDir tmp\pipeline\wi-3224 -Status interrompido
  log-fase.ps1 -Acao resumo -WorkDir tmp\pipeline\wi-3224
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('inicio', 'fim', 'fechar-abertas', 'resumo')]
  [string]$Acao,

  [Parameter(Mandatory = $true)]
  [string]$WorkDir,

  [string]$Fase,

  [string]$Wi,

  [ValidateSet('trabalho', 'espera')]
  [string]$Tipo = 'trabalho',

  [ValidateSet('ok', 'falha', 'escalado', 'cancelado', 'interrompido')]
  [string]$Status = 'ok',

  [string]$Nota = '',

  [string]$Csv
)

$ErrorActionPreference = 'Stop'

if (-not $Csv) {
  $baseHome = $env:USERPROFILE
  if (-not $baseHome) { $baseHome = $HOME }
  $Csv = Join-Path $baseHome '.claude\brixbroker\pipeline-tempos.csv'
}

$Sep = ';'
$Header = 'run_id;wi;fase;tipo;inicio;fim;duracao_seg;duracao;status;nota'
$stateDir = Join-Path $WorkDir '.fases'

function Get-SafeName([string]$name) {
  return ($name -replace '[^A-Za-z0-9._-]', '_')
}

function Format-Duration([double]$seconds) {
  $ts = [TimeSpan]::FromSeconds([math]::Round($seconds))
  return ('{0:00}:{1:00}:{2:00}' -f [math]::Floor($ts.TotalHours), $ts.Minutes, $ts.Seconds)
}

function Clean([string]$text) {
  if ($null -eq $text) { return '' }
  return (($text -replace ';', ',') -replace '[\r\n]+', ' ').Trim()
}

function Read-Meta([string]$key) {
  $path = Join-Path $stateDir "_$key"
  if (Test-Path -LiteralPath $path) { return (Get-Content -LiteralPath $path -Raw).Trim() }
  return ''
}

function Append-CsvLine([string]$line) {
  $dir = Split-Path -Parent $Csv
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $utf8Bom = New-Object System.Text.UTF8Encoding($true)
  if (-not (Test-Path -LiteralPath $Csv)) {
    [System.IO.File]::WriteAllText($Csv, $Header + "`r`n", $utf8Bom)
  }
  for ($i = 0; $i -lt 10; $i++) {
    try {
      [System.IO.File]::AppendAllText($Csv, $line + "`r`n", $utf8Bom)
      return
    } catch [System.IO.IOException] {
      # CSV aberto no Excel ou outro processo gravando: espera e tenta de novo.
      Start-Sleep -Milliseconds 500
    }
  }
  throw "Não consegui gravar em $Csv (arquivo aberto em outro programa?)."
}

function Close-Phase([string]$name, [string]$status, [string]$nota) {
  $file = Join-Path $stateDir ((Get-SafeName $name) + '.txt')
  if (-not (Test-Path -LiteralPath $file)) {
    Write-Warning "Fase '$name' não está aberta em $stateDir; nada registrado."
    return
  }
  $parts = (Get-Content -LiteralPath $file -Raw).Trim() -split '\|', 3
  $start = [DateTimeOffset]::Parse($parts[0], [Globalization.CultureInfo]::InvariantCulture)
  $tipoFase = $parts[1]
  $faseNome = $parts[2]
  $end = [DateTimeOffset]::Now
  $secs = ($end - $start).TotalSeconds

  $cols = @(
    (Read-Meta 'run-id'),
    (Read-Meta 'wi'),
    (Clean $faseNome),
    $tipoFase,
    $start.ToString('yyyy-MM-ddTHH:mm:sszzz'),
    $end.ToString('yyyy-MM-ddTHH:mm:sszzz'),
    [math]::Round($secs).ToString([Globalization.CultureInfo]::InvariantCulture),
    (Format-Duration $secs),
    $status,
    (Clean $nota)
  )
  Append-CsvLine ($cols -join $Sep)
  Remove-Item -LiteralPath $file -Force

  # Fechar a fase 'pipeline' encerra o run: o próximo inicio gera run_id novo.
  if ($faseNome -eq 'pipeline') {
    $runFile = Join-Path $stateDir '_run-id'
    if (Test-Path -LiteralPath $runFile) {
      Move-Item -LiteralPath $runFile -Destination (Join-Path $stateDir '_ultimo-run') -Force
    }
  }
  Write-Output ("{0} {1} ({2})" -f $faseNome, (Format-Duration $secs), $status)
}

switch ($Acao) {

  'inicio' {
    if (-not $Fase) { throw '-Fase é obrigatório em inicio.' }
    if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

    # A primeira fase do run cria o run_id; as demais reaproveitam.
    $runFile = Join-Path $stateDir '_run-id'
    if (-not (Test-Path -LiteralPath $runFile)) {
      $runId = (Get-Date).ToString('yyyyMMdd-HHmmss')
      Set-Content -LiteralPath $runFile -Value $runId -NoNewline
    }
    if ($Wi) { Set-Content -LiteralPath (Join-Path $stateDir '_wi') -Value $Wi -NoNewline }

    $file = Join-Path $stateDir ((Get-SafeName $Fase) + '.txt')
    if (Test-Path -LiteralPath $file) {
      Write-Warning "Fase '$Fase' já estava aberta; mantendo o início original."
      return
    }
    $now = [DateTimeOffset]::Now.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    Set-Content -LiteralPath $file -Value ("{0}|{1}|{2}" -f $now, $Tipo, $Fase) -NoNewline
    Write-Output ("inicio {0} ({1}) run {2}" -f $Fase, $Tipo, (Read-Meta 'run-id'))
  }

  'fim' {
    if (-not $Fase) { throw '-Fase é obrigatório em fim.' }
    Close-Phase $Fase $Status $Nota
  }

  'fechar-abertas' {
    # Fecha tudo que ficou aberto (pipeline interrompido, sessão caiu, cancelado).
    if (-not (Test-Path -LiteralPath $stateDir)) { return }
    $nota = $Nota
    if (-not $nota) { $nota = 'fechada sem fim registrado; a duração inclui o tempo parado' }
    Get-ChildItem -LiteralPath $stateDir -Filter '*.txt' | ForEach-Object {
      $parts = (Get-Content -LiteralPath $_.FullName -Raw).Trim() -split '\|', 3
      [pscustomobject]@{ Nome = $parts[2]; Inicio = $parts[0] }
    } | Sort-Object Inicio -Descending | ForEach-Object {
      # Mais interna primeiro; 'pipeline' fecha por último e encerra o run.
      Close-Phase $_.Nome $Status $nota
    }
  }

  'resumo' {
    $runId = Read-Meta 'run-id'
    if (-not $runId) { $runId = Read-Meta 'ultimo-run' }
    if (-not $runId) { throw "Nenhum run em $stateDir." }
    if (-not (Test-Path -LiteralPath $Csv)) { throw "CSV não encontrado: $Csv" }
    $rows = Import-Csv -LiteralPath $Csv -Delimiter $Sep | Where-Object { $_.run_id -eq $runId }
    $rows | Select-Object fase, tipo, duracao, status, nota | Format-Table -AutoSize | Out-String -Width 200 | Write-Output

    $sum = { param($r) ($r | Measure-Object -Property duracao_seg -Sum).Sum }
    $total = $rows | Where-Object { $_.fase -eq 'pipeline' }
    $espera = & $sum ($rows | Where-Object { $_.tipo -eq 'espera' })
    if (-not $espera) { $espera = 0 }
    if ($total) {
      $t = [double]$total[0].duracao_seg
      Write-Output ("Total: {0} | esperando o dev: {1} | trabalhando: {2}" -f (Format-Duration $t), (Format-Duration $espera), (Format-Duration ($t - $espera)))
    }
    Write-Output "CSV: $Csv (run $runId)"
  }
}
