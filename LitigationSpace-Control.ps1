# LitigationSpace Control — one place to open, preview, and manage the site
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$SshKey = "$env:USERPROFILE\.ssh\id_ed25519"
$Vps = "root@72.62.165.54"
$LiveUrl = "https://litigationspace.com"
$LocalUrl = "http://localhost:5173"
$PreviewPidFile = Join-Path $Root ".local-preview.pid"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "LitigationSpace"
$form.Size = New-Object System.Drawing.Size(420, 380)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)

function New-Button($text, $y, $color) {
    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = $text
    $btn.Location = New-Object System.Drawing.Point(40, $y)
    $btn.Size = New-Object System.Drawing.Size(340, 48)
    $btn.FlatStyle = "Flat"
    $btn.BackColor = $color
    $btn.ForeColor = [System.Drawing.Color]::White
    $btn.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
    $form.Controls.Add($btn)
    return $btn
}

function Set-Status($msg) {
    $statusLabel.Text = $msg
    $form.Refresh()
}

$title = New-Object System.Windows.Forms.Label
$title.Text = "LitigationSpace Control"
$title.Location = New-Object System.Drawing.Point(40, 20)
$title.Size = New-Object System.Drawing.Size(340, 30)
$title.ForeColor = [System.Drawing.Color]::FromArgb(251, 191, 36)
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "One program — live site, code, and local preview"
$subtitle.Location = New-Object System.Drawing.Point(40, 52)
$subtitle.Size = New-Object System.Drawing.Size(340, 20)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$subtitle.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.Controls.Add($subtitle)

$gold = [System.Drawing.Color]::FromArgb(180, 130, 20)
$blue = [System.Drawing.Color]::FromArgb(37, 99, 235)
$green = [System.Drawing.Color]::FromArgb(22, 101, 52)
$slate = [System.Drawing.Color]::FromArgb(51, 65, 85)

$btnLive = New-Button "Open Live Site" 90 $gold
$btnFolder = New-Button "Open Code Folder" 148 $slate
$btnPreview = New-Button "Start Local Preview" 206 $blue
$btnRestart = New-Button "Restart Live Server" 264 $green

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "Ready"
$statusLabel.Location = New-Object System.Drawing.Point(40, 322)
$statusLabel.Size = New-Object System.Drawing.Size(340, 20)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$form.Controls.Add($statusLabel)

$btnLive.Add_Click({
    Set-Status "Opening live site..."
    Start-Process $LiveUrl
    Set-Status "Live site opened"
})

$btnFolder.Add_Click({
    Set-Status "Opening code folder..."
    Start-Process "explorer.exe" $Root
    Set-Status "Code folder opened"
})

$btnPreview.Add_Click({
    if (Test-Path $PreviewPidFile) {
        $oldPid = Get-Content $PreviewPidFile -ErrorAction SilentlyContinue
        if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
            Start-Process $LocalUrl
            Set-Status "Local preview already running"
            return
        }
    }
    Set-Status "Starting local preview..."
    $proc = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $Root -PassThru -WindowStyle Hidden
    $proc.Id | Set-Content $PreviewPidFile
    Start-Sleep -Seconds 2
    Start-Process $LocalUrl
    Set-Status "Local preview: $LocalUrl"
})

$btnRestart.Add_Click({
    Set-Status "Restarting live server..."
    $result = & ssh -i $SshKey -o StrictHostKeyChecking=no -o ConnectTimeout=15 $Vps "systemctl restart litigationspace-staging && systemctl reload nginx && sleep 2 && curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8002/healthz" 2>&1
    if ($result -match '200') {
        Set-Status "Live server restarted — site is up"
        [System.Windows.Forms.MessageBox]::Show("litigationspace.com restarted successfully.", "LitigationSpace", "OK", "Information")
    } else {
        Set-Status "Restart may have failed — check VPS"
        [System.Windows.Forms.MessageBox]::Show("Restart finished but health check returned: $result", "LitigationSpace", "OK", "Warning")
    }
})

[void]$form.ShowDialog()