# server.ps1 - Health Booth Game Server with Realtime Room Sync
# Run this script with PowerShell to host the game on local Wi-Fi / Hotspot!

$port = 8088

# Find local IPv4 address
$ipAddress = "127.0.0.1"
try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
        $_.InterfaceAlias -notmatch "Loopback|vEthernet|Virtual" -and 
        $_.IPAddress -notmatch "^169\.254\." -and
        $_.IPAddress -notmatch "^127\."
    } | Select-Object -First 1).IPAddress
    if ($ip) { $ipAddress = $ip }
} catch {
    $ipAddress = "127.0.0.1"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://*:$port/")

# In-memory State
$global:GameState = @{
    status = "lobby" # lobby, countdown, playing, finished
    selectedGame = "quiz" # quiz, tap, catch, swipe
    gameDuration = 30
    countdown = 3
    roomCode = "HEALTH2026"
    maxPlayers = 10
    players = @()
    currentQuestions = @()
    prizeRules = @{
        minPlayers = 1
        tier = "auto"
    }
}
$global:History = @()
$global:QuestionsFile = Join-Path $PSScriptRoot "questions_custom.json"

# Load custom questions if exists
if (Test-Path $global:QuestionsFile) {
    try {
        $json = Get-Content $global:QuestionsFile -Raw -Encoding UTF8
        $global:CustomQuestions = ConvertFrom-Json $json
    } catch {
        $global:CustomQuestions = $null
    }
}

try {
    $listener.Start()
    Clear-Host
    Write-Host "==================================================================" -ForegroundColor Green
    Write-Host "   HEALTH BOOTH GAME SYSTEM (2-DAY EVENT BOOTH)                   " -ForegroundColor Cyan
    Write-Host "==================================================================" -ForegroundColor Green
    Write-Host " [OK] Server is running successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host " [PLAYER URL] Share this with employees or print as QR Code:" -ForegroundColor Yellow
    Write-Host "    http://$($ipAddress):$port/" -ForegroundColor White -BackgroundColor DarkGreen
    Write-Host ""
    Write-Host " [ADMIN URL] Admin control console on phone/tablet:" -ForegroundColor Yellow
    Write-Host "    http://$($ipAddress):$port/admin.html" -ForegroundColor White -BackgroundColor DarkBlue
    Write-Host ""
    Write-Host " (Press Ctrl+C to stop the server anytime)" -ForegroundColor Gray
    Write-Host "==================================================================" -ForegroundColor Green

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        $urlPath = $request.Url.LocalPath
        $method = $request.HttpMethod

        # Enable CORS
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

        if ($method -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        # API Routes
        if ($urlPath.StartsWith("/api/")) {
            $response.ContentType = "application/json; charset=utf-8"
            
            # Read POST body if present
            $body = ""
            if ($request.HasEntityBody) {
                $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                $reader.Close()
            }

            $resultObj = @{}

            if ($urlPath -eq "/api/state") {
                $resultObj = $global:GameState
            }
            elseif ($urlPath -eq "/api/join" -and $method -eq "POST") {
                $pData = ConvertFrom-Json $body
                # Check if already in room
                $existing = $global:GameState.players | Where-Object { $_.empId -eq $pData.empId }
                if (-not $existing) {
                    if ($global:GameState.players.Count -lt $global:GameState.maxPlayers) {
                        $newPlayer = @{
                            empId = $pData.empId
                            name = $pData.name
                            avatar = $pData.avatar
                            score = 0
                            finished = $false
                            rank = 0
                            joinedAt = (Get-Date).ToString("o")
                        }
                        $global:GameState.players += $newPlayer
                        $resultObj = @{ success = $true; player = $newPlayer; total = $global:GameState.players.Count }
                    } else {
                        $resultObj = @{ success = $false; message = "ห้องเต็มแล้ว (สูงสุด 10 คน)" }
                    }
                } else {
                    $resultObj = @{ success = $true; player = $existing; total = $global:GameState.players.Count }
                }
            }
            elseif ($urlPath -eq "/api/admin/start" -and $method -eq "POST") {
                $cmd = ConvertFrom-Json $body
                $global:GameState.selectedGame = $cmd.selectedGame
                $global:GameState.status = "playing"
                $global:GameState.startedAt = (Get-Date).ToString("o")
                if ($cmd.questions) {
                    $global:GameState.currentQuestions = $cmd.questions
                }
                # Reset player scores for this round
                foreach ($p in $global:GameState.players) {
                    $p.score = 0
                    $p.finished = $false
                    $p.rank = 0
                }
                $resultObj = @{ success = $true; state = $global:GameState }
            }
            elseif ($urlPath -eq "/api/score" -and $method -eq "POST") {
                $sData = ConvertFrom-Json $body
                foreach ($p in $global:GameState.players) {
                    if ($p.empId -eq $sData.empId) {
                        $p.score = [int]$sData.score
                        $p.finished = $true
                        break
                    }
                }
                # Re-rank players
                $sorted = $global:GameState.players | Sort-Object -Property score -Descending
                $r = 1
                foreach ($sp in $sorted) {
                    $sp.rank = $r
                    $r++
                }
                # Check if all players finished
                $allDone = $true
                foreach ($p in $global:GameState.players) {
                    if (-not $p.finished) { $allDone = $false; break }
                }
                if ($allDone -and $global:GameState.players.Count -gt 0) {
                    $global:GameState.status = "finished"
                    # Archive to history
                    $roundRecord = @{
                        roundId = [guid]::NewGuid().ToString()
                        game = $global:GameState.selectedGame
                        playedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                        totalPlayers = $global:GameState.players.Count
                        players = $global:GameState.players
                    }
                    $global:History += $roundRecord
                }
                $resultObj = @{ success = $true; state = $global:GameState }
            }
            elseif ($urlPath -eq "/api/admin/reset" -and $method -eq "POST") {
                $global:GameState.status = "lobby"
                $global:GameState.players = @()
                $global:GameState.currentQuestions = @()
                $resultObj = @{ success = $true }
            }
            elseif ($urlPath -eq "/api/history") {
                $resultObj = @{ history = $global:History }
            }
            else {
                $resultObj = @{ error = "Endpoint not found" }
            }

            $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $resultObj -Depth 6))
            $response.ContentLength64 = $jsonBytes.Length
            $response.OutputStream.Write($jsonBytes, 0, $jsonBytes.Length)
            $response.Close()
            continue
        }

        # Static File Serving
        if ($urlPath -eq "/") { $urlPath = "/index.html" }
        $filePath = Join-Path $PSScriptRoot $urlPath.TrimStart('/')

        if (Test-Path $filePath -PathType Leaf) {
            $extension = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = switch ($extension) {
                ".html" { "text/html; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".js"   { "text/javascript; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".svg"  { "image/svg+xml" }
                ".png"  { "image/png" }
                ".jpg"  { "image/jpeg" }
                ".ico"  { "image/x-icon" }
                default { "application/octet-stream" }
            }

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 File Not Found")
            $response.ContentType = "text/plain; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        $response.Close()
    }
} catch {
    Write-Host "Server encountered an error or stopped: $_" -ForegroundColor Red
} finally {
    if ($listener) { $listener.Stop() }
}
