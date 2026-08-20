param(
  [int]$ClientProcessId = 19160,
  [int]$Port = 37666,
  [switch]$AutoStart,
  [switch]$AutoExplore
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CapturePath = Join-Path $ProjectRoot 'captures\decrypted-gameplay-session2.jsonl'
$TrainerLog = Join-Path $ProjectRoot 'captures\bridge-trainer.log'
$StdoutLog = Join-Path $ProjectRoot 'captures\bridge-bot-gui.stdout.log'
$StderrLog = Join-Path $ProjectRoot 'captures\bridge-bot-gui.stderr.log'
$RunnerPath = Join-Path $ProjectRoot 'scripts\run-bridge-trainer.js'
$ExplorerPath = Join-Path $ProjectRoot 'scripts\run-world-explorer.js'
$ControlScript = Join-Path $ProjectRoot 'scripts\start-control-agent.ps1'
$DexControlScript = Join-Path $ProjectRoot 'scripts\start-dex-agent.ps1'
$BattleControlScript = Join-Path $ProjectRoot 'scripts\start-battle-control-agent.ps1'
$HuntControlScript = Join-Path $ProjectRoot 'scripts\start-hunt-control-agent.ps1'
$SpeciesControlScript = Join-Path $ProjectRoot 'scripts\start-species-agent.ps1'
$ExplorerLog = Join-Path $ProjectRoot 'captures\world-explorer.log'
$ExplorerStatus = Join-Path $ProjectRoot 'captures\explorer-status.json'
$EncounterDex = Join-Path $ProjectRoot 'captures\encounter-dex.json'
$script:BotProcess = $null
$script:BotMode = 'trainer'
$script:LastRendered = ''

function New-Color([string]$Hex) {
  [System.Drawing.ColorTranslator]::FromHtml($Hex)
}

$Bg = New-Color '#101419'
$Panel = New-Color '#192028'
$Panel2 = New-Color '#202A35'
$Text = New-Color '#E8EDF2'
$Muted = New-Color '#96A5B4'
$Accent = New-Color '#E94F64'
$Green = New-Color '#50C878'
$Amber = New-Color '#F0B44D'

$form = New-Object System.Windows.Forms.Form
$form.Text = 'PokeMMO Training & Hunt Bot'
$form.Size = New-Object System.Drawing.Size(900, 740)
$form.MinimumSize = New-Object System.Drawing.Size(900, 740)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $Bg
$form.ForeColor = $Text
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'TRAINING & HUNT BOT'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 21)
$title.ForeColor = $Text
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(28, 22)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Choose an activity. Battles, routing, shiny safety, and recovery run automatically.'
$subtitle.ForeColor = $Muted
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(31, 62)
$form.Controls.Add($subtitle)

$statusPill = New-Object System.Windows.Forms.Label
$statusPill.Text = '  STOPPED  '
$statusPill.TextAlign = 'MiddleCenter'
$statusPill.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$statusPill.BackColor = $Panel2
$statusPill.ForeColor = $Muted
$statusPill.Size = New-Object System.Drawing.Size(130, 32)
$statusPill.Location = New-Object System.Drawing.Point(730, 28)
$form.Controls.Add($statusPill)

$configPanel = New-Object System.Windows.Forms.Panel
$configPanel.BackColor = $Panel
$configPanel.Location = New-Object System.Drawing.Point(28, 94)
$configPanel.Size = New-Object System.Drawing.Size(832, 178)
$form.Controls.Add($configPanel)

function Add-Field([System.Windows.Forms.Control]$Parent, [string]$Label, [string]$Value, [int]$X, [int]$Width) {
  $caption = New-Object System.Windows.Forms.Label
  $caption.Text = $Label.ToUpperInvariant()
  $caption.ForeColor = $Muted
  $caption.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 8)
  $caption.Location = New-Object System.Drawing.Point($X, 15)
  $caption.Size = New-Object System.Drawing.Size($Width, 18)
  $Parent.Controls.Add($caption)
  $box = New-Object System.Windows.Forms.TextBox
  $box.Text = $Value
  $box.BackColor = $Panel2
  $box.ForeColor = $Text
  $box.BorderStyle = 'FixedSingle'
  $box.Location = New-Object System.Drawing.Point($X, 38)
  $box.Size = New-Object System.Drawing.Size($Width, 29)
  $Parent.Controls.Add($box)
  return $box
}

$pidBox = Add-Field $configPanel 'Client PID' "$ClientProcessId" 18 86
$moveBox = New-Object System.Windows.Forms.TextBox; $moveBox.Text = '52'

$modeCaption = New-Object System.Windows.Forms.Label
$modeCaption.Text = 'ACTIVITY'
$modeCaption.ForeColor = $Muted
$modeCaption.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 8)
$modeCaption.Location = New-Object System.Drawing.Point(119, 15)
$modeCaption.Size = New-Object System.Drawing.Size(172, 18)
$configPanel.Controls.Add($modeCaption)
$modeBox = New-Object System.Windows.Forms.ComboBox
$modeBox.DropDownStyle = 'DropDownList'
$modeBox.BackColor = $Panel2
$modeBox.ForeColor = $Text
$modeBox.Location = New-Object System.Drawing.Point(119, 38)
$modeBox.Size = New-Object System.Drawing.Size(172, 29)
[void]$modeBox.Items.AddRange(@('Explore & map', 'Train by level', 'Hunt a species', 'Shiny hunt'))
$modeBox.SelectedIndex = 0
$configPanel.Controls.Add($modeBox)
$maxBox = Add-Field $configPanel 'Battle cap (0=∞)' '0' 243 90
$sweepBox = Add-Field $configPanel 'Sweep tiles' '16' 348 90
$stepBox = Add-Field $configPanel 'Step ms' '240' 453 90
$captureBox = Add-Field $configPanel 'Capture' $CapturePath 558 255

$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'Unlimited mode enabled. Battle moves are selected from live damaging moves with PP.'
$hint.ForeColor = $Muted
$hint.AutoSize = $true
$hint.Location = New-Object System.Drawing.Point(18, 79)
$configPanel.Controls.Add($hint)

# Replace the legacy packet-oriented fields with activity choices a player can read.
$configPanel.Controls.Clear()
$pidBox = Add-Field $configPanel 'Client PID' "$ClientProcessId" 18 86
$modeCaption = New-Object System.Windows.Forms.Label
$modeCaption.Text = 'ACTIVITY'
$modeCaption.ForeColor = $Muted
$modeCaption.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 8)
$modeCaption.Location = New-Object System.Drawing.Point(119, 15)
$modeCaption.Size = New-Object System.Drawing.Size(172, 18)
$configPanel.Controls.Add($modeCaption)
$modeBox = New-Object System.Windows.Forms.ComboBox
$modeBox.DropDownStyle = 'DropDownList'
$modeBox.BackColor = $Panel2
$modeBox.ForeColor = $Text
$modeBox.Location = New-Object System.Drawing.Point(119, 38)
$modeBox.Size = New-Object System.Drawing.Size(172, 29)
[void]$modeBox.Items.AddRange(@('Explore & map', 'Train by level', 'Hunt a species', 'Shiny hunt'))
$modeBox.SelectedIndex = 0
$configPanel.Controls.Add($modeBox)
$targetBox = Add-Field $configPanel 'Pokemon to hunt' '' 306 178
$levelMinBox = Add-Field $configPanel 'Min level' '2' 499 70
$levelMaxBox = Add-Field $configPanel 'Max level' '100' 584 70
$stepBox = Add-Field $configPanel 'Walking pace' '240' 669 92
$captureBox.Text = $CapturePath

$shinyCheck = New-Object System.Windows.Forms.CheckBox
$shinyCheck.Text = 'Always catch any shiny encountered'
$shinyCheck.Checked = $true
$shinyCheck.ForeColor = $Text
$shinyCheck.AutoSize = $true
$shinyCheck.Location = New-Object System.Drawing.Point(18, 88)
$configPanel.Controls.Add($shinyCheck)
$fallbackCheck = New-Object System.Windows.Forms.CheckBox
$fallbackCheck.Text = 'If out of balls, keep battling for levels'
$fallbackCheck.Checked = $true
$fallbackCheck.Enabled = $false
$fallbackCheck.ForeColor = $Muted
$fallbackCheck.AutoSize = $true
$fallbackCheck.Location = New-Object System.Drawing.Point(300, 88)
$configPanel.Controls.Add($fallbackCheck)
$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'No PP: flee from wild battles and heal. Trainer battles continue until win or loss.'
$hint.ForeColor = $Muted
$hint.AutoSize = $true
$hint.Location = New-Object System.Drawing.Point(18, 132)
$configPanel.Controls.Add($hint)

function Add-StatCard([string]$Name, [int]$X) {
  $card = New-Object System.Windows.Forms.Panel
  $card.BackColor = $Panel
  $card.Location = New-Object System.Drawing.Point($X, 288)
  $card.Size = New-Object System.Drawing.Size(194, 88)
  $form.Controls.Add($card)
  $caption = New-Object System.Windows.Forms.Label
  $caption.Text = $Name.ToUpperInvariant()
  $caption.ForeColor = $Muted
  $caption.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 8)
  $caption.Location = New-Object System.Drawing.Point(14, 12)
  $caption.AutoSize = $true
  $card.Controls.Add($caption)
  $value = New-Object System.Windows.Forms.Label
  $value.Text = '0'
  $value.ForeColor = $Text
  $value.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 24)
  $value.Location = New-Object System.Drawing.Point(12, 34)
  $value.AutoSize = $true
  $card.Controls.Add($value)
  return $value
}

$movesValue = Add-StatCard 'Movement inputs' 28
$encountersValue = Add-StatCard 'Encounters' 241
$turnsValue = Add-StatCard 'Known tiles' 454
$battlesValue = Add-StatCard 'Battles complete' 667

$phaseLabel = New-Object System.Windows.Forms.Label
$phaseLabel.Text = 'Phase: idle'
$phaseLabel.ForeColor = $Muted
$phaseLabel.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$phaseLabel.Location = New-Object System.Drawing.Point(30, 393)
$phaseLabel.AutoSize = $true
$form.Controls.Add($phaseLabel)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = 'START'
$startButton.FlatStyle = 'Flat'
$startButton.FlatAppearance.BorderSize = 0
$startButton.BackColor = $Accent
$startButton.ForeColor = [System.Drawing.Color]::White
$startButton.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$startButton.Location = New-Object System.Drawing.Point(624, 386)
$startButton.Size = New-Object System.Drawing.Size(112, 36)
$form.Controls.Add($startButton)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = 'STOP'
$stopButton.FlatStyle = 'Flat'
$stopButton.FlatAppearance.BorderColor = $Muted
$stopButton.BackColor = $Panel2
$stopButton.ForeColor = $Text
$stopButton.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$stopButton.Location = New-Object System.Drawing.Point(748, 386)
$stopButton.Size = New-Object System.Drawing.Size(112, 36)
$form.Controls.Add($stopButton)

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.ReadOnly = $true
$logBox.BackColor = New-Color '#0B0F13'
$logBox.ForeColor = New-Color '#B8C7D5'
$logBox.BorderStyle = 'None'
$logBox.Font = New-Object System.Drawing.Font('Cascadia Mono', 9)
$logBox.Location = New-Object System.Drawing.Point(28, 436)
$logBox.Size = New-Object System.Drawing.Size(832, 224)
$logBox.Anchor = 'Top,Bottom,Left,Right'
$form.Controls.Add($logBox)

$footer = New-Object System.Windows.Forms.Label
$footer.Text = "Control: 127.0.0.1:$Port  |  Exact MOVE packet via official encrypted session"
$footer.ForeColor = $Muted
$footer.Location = New-Object System.Drawing.Point(28, 676)
$footer.AutoSize = $true
$footer.Anchor = 'Bottom,Left'
$form.Controls.Add($footer)

function Test-ControlChannel {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(350)) { $client.Dispose(); return $false }
    $client.EndConnect($connect)
    $stream = $client.GetStream()
    $writer = [System.IO.StreamWriter]::new($stream)
    $reader = [System.IO.StreamReader]::new($stream)
    $writer.AutoFlush = $true
    $writer.WriteLine('PING')
    $answer = $reader.ReadLine()
    $client.Dispose()
    return $answer -like 'OK PONG*'
  } catch { return $false }
}

function Test-DexChannel {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect('127.0.0.1', 37667, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(350)) { $client.Dispose(); return $false }
    $client.EndConnect($connect)
    $stream = $client.GetStream()
    $writer = [System.IO.StreamWriter]::new($stream)
    $reader = [System.IO.StreamReader]::new($stream)
    $writer.AutoFlush = $true
    $writer.WriteLine('PING')
    $answer = $reader.ReadLine()
    $client.Dispose()
    return $answer -eq 'OK PONG DEX'
  } catch { return $false }
}

function Test-BattleChannel {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect('127.0.0.1', 37668, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(350)) { $client.Dispose(); return $false }
    $client.EndConnect($connect)
    $stream = $client.GetStream()
    $writer = [System.IO.StreamWriter]::new($stream)
    $reader = [System.IO.StreamReader]::new($stream)
    $writer.AutoFlush = $true
    $writer.WriteLine('PING')
    $answer = $reader.ReadLine()
    $client.Dispose()
    return $answer -eq 'OK PONG BATTLE'
  } catch { return $false }
}

function Test-HuntChannel {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect('127.0.0.1', 37671, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(350)) { $client.Dispose(); return $false }
    $client.EndConnect($connect)
    $stream = $client.GetStream()
    $writer = [System.IO.StreamWriter]::new($stream)
    $reader = [System.IO.StreamReader]::new($stream)
    $writer.AutoFlush = $true
    $writer.WriteLine('PING')
    $answer = $reader.ReadLine()
    $client.Dispose()
    return $answer -eq 'OK PONG HUNT'
  } catch { return $false }
}

function Test-SpeciesChannel {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect('127.0.0.1', 37670, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(350)) { $client.Dispose(); return $false }
    $client.EndConnect($connect)
    $stream = $client.GetStream()
    $writer = [System.IO.StreamWriter]::new($stream)
    $reader = [System.IO.StreamReader]::new($stream)
    $writer.AutoFlush = $true
    $writer.WriteLine('PING')
    $answer = $reader.ReadLine()
    $client.Dispose()
    return $answer -eq 'OK PONG SPECIES'
  } catch { return $false }
}

function Set-UiStatus([string]$TextValue, [System.Drawing.Color]$Color) {
  $statusPill.Text = "  $TextValue  "
  $statusPill.ForeColor = $Color
}

function Start-Bot {
  try {
    if ($script:BotProcess -and -not $script:BotProcess.HasExited) { return }
    $selectedPid = [int]$pidBox.Text
    if (-not (Get-Process -Id $selectedPid -ErrorAction SilentlyContinue)) {
      throw "Client process $selectedPid is not running."
    }
    if (-not (Test-Path -LiteralPath $captureBox.Text)) {
      throw "Capture file does not exist: $($captureBox.Text)"
    }
    if (-not (Test-ControlChannel)) {
      $attach = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ControlScript,
        '-ProcessId', "$selectedPid", '-Port', "$Port"
      ) -WindowStyle Hidden -Wait -PassThru
      if ($attach.ExitCode -ne 0 -or -not (Test-ControlChannel)) {
        throw 'Could not attach the persistent control agent.'
      }
    }
    $arguments = @(
      $RunnerPath,
      '--capture', $captureBox.Text,
      '--move-id', ([int]$moveBox.Text),
      '--max-battles', ([int]$maxBox.Text),
      '--sweep', ([int]$sweepBox.Text),
      '--step-ms', ([int]$stepBox.Text),
      '--port', $Port
    )
    $script:BotProcess = Start-Process -FilePath 'node.exe' -ArgumentList $arguments `
      -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
      -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
    Set-UiStatus 'RUNNING' $Green
    $script:BotMode = 'trainer'
    $phaseLabel.Text = 'Phase: starting'
  } catch {
    Set-UiStatus 'ERROR' $Accent
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Bridge Trainer', 'OK', 'Error') | Out-Null
  }
}

function Start-Explore {
  try {
    if ($script:BotProcess -and -not $script:BotProcess.HasExited) { return }
    $selectedPid = [int]$pidBox.Text
    if (-not (Get-Process -Id $selectedPid -ErrorAction SilentlyContinue)) {
      throw "Client process $selectedPid is not running."
    }
    if (-not (Test-Path -LiteralPath $captureBox.Text)) {
      throw "Capture file does not exist: $($captureBox.Text)"
    }
    if (-not (Test-ControlChannel)) {
      $attach = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ControlScript,
        '-ProcessId', "$selectedPid", '-Port', "$Port"
      ) -WindowStyle Hidden -Wait -PassThru
      if ($attach.ExitCode -ne 0 -or -not (Test-ControlChannel)) {
        throw 'Could not attach the persistent control agent.'
      }
    }
    if (-not (Test-DexChannel)) {
      $dexAttach = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $DexControlScript,
        '-ProcessId', "$selectedPid", '-Port', '37667'
      ) -WindowStyle Hidden -Wait -PassThru
      if ($dexAttach.ExitCode -ne 0 -or -not (Test-DexChannel)) {
        throw 'Could not attach the read-only Wild Locations agent.'
      }
    }
    if (-not (Test-BattleChannel)) {
      $battleAttach = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $BattleControlScript,
        '-ProcessId', "$selectedPid", '-Port', '37668'
      ) -WindowStyle Hidden -Wait -PassThru
      if ($battleAttach.ExitCode -ne 0 -or -not (Test-BattleChannel)) {
        throw 'Could not attach the PP-aware battle control agent.'
      }
    }
    if (-not (Test-HuntChannel)) {
      $huntAttach = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $HuntControlScript,
        '-ProcessId', "$selectedPid", '-Port', '37671'
      ) -WindowStyle Hidden -Wait -PassThru
      if ($huntAttach.ExitCode -ne 0 -or -not (Test-HuntChannel)) {
        throw 'Could not attach the wild/trainer battle policy agent.'
      }
    }
    if (-not (Test-SpeciesChannel)) {
      $speciesAttach = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $SpeciesControlScript,
        '-ProcessId', "$selectedPid", '-Port', '37670'
      ) -WindowStyle Hidden -Wait -PassThru
      if ($speciesAttach.ExitCode -ne 0 -or -not (Test-SpeciesChannel)) {
        throw 'Could not attach the read-only Pokemon name resolver.'
      }
    }
    $modeKey = switch ($modeBox.SelectedIndex) {
      1 { 'train' }
      2 { 'hunt' }
      3 { 'shiny' }
      default { 'explore' }
    }
    if ($modeKey -eq 'hunt' -and [string]::IsNullOrWhiteSpace($targetBox.Text)) {
      throw 'Choose a Pokemon name or species number to hunt.'
    }
    $arguments = @(
      $ExplorerPath,
      '--capture', $captureBox.Text,
      '--step-ms', ([int]$stepBox.Text),
      '--port', $Port,
      '--dex-port', 37667,
      '--battle-port', 37668,
      '--hunt-port', 37671,
      '--species-port', 37670,
      '--client-pid', $selectedPid,
      '--mode', $modeKey,
      '--level-min', ([int]$levelMinBox.Text),
      '--level-max', ([int]$levelMaxBox.Text),
      '--always-catch-shiny', $shinyCheck.Checked.ToString().ToLowerInvariant(),
      '--graph', (Join-Path $ProjectRoot 'captures\world-graph.json'),
      '--encounters', $EncounterDex,
      '--status', $ExplorerStatus,
      '--log', $ExplorerLog
    )
    if (-not [string]::IsNullOrWhiteSpace($targetBox.Text)) {
      $arguments += @('--target-species', $targetBox.Text.Trim())
    }
    $script:BotProcess = Start-Process -FilePath 'node.exe' -ArgumentList $arguments `
      -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
      -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
    $script:BotMode = 'explore'
    Set-UiStatus $modeKey.ToUpperInvariant() $Green
    $phaseLabel.Text = 'Phase: starting activity'
  } catch {
    Set-UiStatus 'ERROR' $Accent
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'World Explorer', 'OK', 'Error') | Out-Null
  }
}

function Stop-Bot {
  if ($script:BotProcess -and -not $script:BotProcess.HasExited) {
    Stop-Process -Id $script:BotProcess.Id
    $script:BotProcess.WaitForExit(1500) | Out-Null
  }
  $script:BotProcess = $null
  $script:BotMode = 'trainer'
  Set-UiStatus 'STOPPED' $Muted
  $phaseLabel.Text = 'Phase: idle'
}

function Refresh-Dashboard {
  $running = $script:BotProcess -and -not $script:BotProcess.HasExited
  if (-not $running -and $statusPill.Text -match 'RUNNING') {
    Set-UiStatus 'STOPPED' $Muted
  }
  if ($script:BotMode -eq 'explore') {
    if (Test-Path -LiteralPath $ExplorerStatus) {
      try {
        $explorer = Get-Content -LiteralPath $ExplorerStatus -Raw | ConvertFrom-Json
        $movesValue.Text = $explorer.totals.steps
        $encountersValue.Text = $explorer.totals.encounters
        $turnsValue.Text = $explorer.totals.tiles
        $battlesValue.Text = $explorer.totals.battles
        $readablePhase = switch ($explorer.phase) {
          'mapping' { 'Exploring unknown paths' }
          'probing' { 'Checking a nearby path' }
          'routing_to_frontier' { 'Walking to unexplored territory' }
          'routing_to_training_area' { 'Walking to the selected training area' }
          'training' { 'Searching for training battles' }
          'hunting' { 'Searching for the selected Pokemon' }
          'encounter' { 'Identifying the encounter' }
          'battle' { 'Choosing a battle action' }
          'battle_transition' { 'Waiting for the battle result' }
          'closing_level_up_prompt' { 'Finishing battle messages' }
          'trainer_battle' { 'Trainer battle: fighting until it ends' }
          'fleeing_for_recovery' { 'Out of PP: leaving this wild battle' }
          'routing_to_center' { 'Walking to the Pokemon Center' }
          'healing_at_center' { 'Healing HP and PP' }
          default { ($explorer.phase -replace '_', ' ') }
        }
        $location = if ($explorer.world.name) { " | $($explorer.world.name) ($($explorer.world.x), $($explorer.world.y))" } else { '' }
        $survey = if ($null -ne $explorer.totals.speciesIndexed) { " | IDs=$($explorer.totals.speciesIndexed) centers=$($explorer.totals.pokemonCenters)" } else { '' }
        $phaseLabel.Text = "Activity: $readablePhase$location$survey"
      } catch {}
    }
    if (Test-Path -LiteralPath $ExplorerLog) {
      $exploreRecords = @()
      foreach ($line in @(Get-Content -LiteralPath $ExplorerLog -Tail 13 -ErrorAction SilentlyContinue)) {
        try { $exploreRecords += ($line | ConvertFrom-Json) } catch {}
      }
      $display = ($exploreRecords | ForEach-Object {
        $time = ([datetime]$_.timestamp).ToLocalTime().ToString('HH:mm:ss')
        $detail = if ($_.event -eq 'tile_discovered') { " $($_.to)" }
          elseif ($_.event -eq 'map_transition') { " $($_.to)" }
          elseif ($_.event -eq 'enemy_identified') { " $($_.species) L$($_.level) shiny=$($_.shiny) wild=$($_.wild)" }
          elseif ($_.event -eq 'tile_blocked') { " $($_.from) dir=$($_.direction)" }
          elseif ($_.event -eq 'pokemon_center_discovered') { " $($_.name) [$($_.status)]" }
          else { '' }
        "$time  $($_.event)$detail"
      }) -join [Environment]::NewLine
      if ($display -ne $script:LastRendered) {
        $script:LastRendered = $display
        $logBox.Text = $display
        $logBox.SelectionStart = $logBox.TextLength
        $logBox.ScrollToCaret()
      }
    }
    return
  }
  if (-not (Test-Path -LiteralPath $TrainerLog)) { return }
  $lines = @(Get-Content -LiteralPath $TrainerLog -Tail 500 -ErrorAction SilentlyContinue)
  $records = @()
  foreach ($line in $lines) {
    try { $records += ($line | ConvertFrom-Json) } catch {}
  }
  $lastStart = -1
  for ($index = 0; $index -lt $records.Count; $index += 1) {
    if ($records[$index].event -eq 'started') { $lastStart = $index }
  }
  if ($lastStart -ge 0) { $records = @($records[$lastStart..($records.Count - 1)]) }
  $movesValue.Text = @($records | Where-Object event -eq 'movement' | Where-Object response -Like 'MOVED*').Count
  $encountersValue.Text = @($records | Where-Object event -eq 'encounter').Count
  $turnsValue.Text = @($records | Where-Object event -eq 'battle_move').Count
  $battlesValue.Text = @($records | Where-Object event -eq 'battle_end').Count
  if ($records.Count -gt 0) {
    $last = $records[-1]
    $phase = switch ($last.event) {
      'movement' { 'searching' }
      'encounter' { 'encounter transition' }
      'turn_ready' { 'choosing move' }
      'battle_move' { 'battle animation' }
      'battle_end' { 'battle complete' }
      'stopped' { 'safety cap reached' }
      'command_error' { 'command error' }
      default { $last.event }
    }
    $phaseLabel.Text = "Phase: $phase"
  }
  $display = ($records | Select-Object -Last 13 | ForEach-Object {
    $time = ([datetime]$_.timestamp).ToLocalTime().ToString('HH:mm:ss')
    $detail = if ($_.event -eq 'movement') { " direction=$($_.direction) $($_.response)" }
      elseif ($_.event -eq 'battle_move') { " $($_.response)" }
      elseif ($_.event -eq 'battle_end') { " total=$($_.battlesCompleted)" }
      else { '' }
    "$time  $($_.event)$detail"
  }) -join [Environment]::NewLine
  if ($display -ne $script:LastRendered) {
    $script:LastRendered = $display
    $logBox.Text = $display
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
  }
}

$exploreButton = New-Object System.Windows.Forms.Button
$exploreButton.Text = 'EXPLORE'
$exploreButton.FlatStyle = 'Flat'
$exploreButton.FlatAppearance.BorderSize = 0
$exploreButton.BackColor = $Green
$exploreButton.ForeColor = [System.Drawing.Color]::White
$exploreButton.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$exploreButton.Location = New-Object System.Drawing.Point(500, 320)
$exploreButton.Size = New-Object System.Drawing.Size(112, 36)
$form.Controls.Add($exploreButton)
$exploreButton.Visible = $false

$startButton.Add_Click({ Start-Explore })
$exploreButton.Add_Click({ Start-Explore })
$stopButton.Add_Click({ Stop-Bot })
$form.Add_FormClosing({ Stop-Bot })
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({ Refresh-Dashboard })
$timer.Start()

if ($AutoExplore) { $form.Add_Shown({ Start-Explore }) }
elseif ($AutoStart) { $form.Add_Shown({ Start-Explore }) }
[System.Windows.Forms.Application]::Run($form)
