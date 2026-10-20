param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$packageDirectory = $PSScriptRoot
$agentDirectory = Split-Path -Parent $packageDirectory
$pythonExecutable = Join-Path $agentDirectory '.venv\Scripts\python.exe'
$configFile = Join-Path $agentDirectory 'config.json'
$dataDirectory = Join-Path $env:LOCALAPPDATA 'YouziShipping'
$address = 'http://127.0.0.1:18765/'
if (!(Test-Path -LiteralPath $pythonExecutable) -or !(Test-Path -LiteralPath $configFile)) {
    throw 'Place shipping-workbench inside the installed YouziSync agent directory.'
}
$isRunning = $false
try {
    $page = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 2
    $isRunning = $page.Content -like '*id="packingPrint"*'
} catch {}
if (!$isRunning) {
    New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    $serverScript = Join-Path $packageDirectory 'shipping_workbench.py'
    $processArguments = '"{0}" --config "{1}" --data-dir "{2}"' -f $serverScript, $configFile, $dataDirectory
    Start-Process -FilePath $pythonExecutable -ArgumentList $processArguments -WindowStyle Hidden `
        -WorkingDirectory $packageDirectory `
        -RedirectStandardOutput (Join-Path $dataDirectory 'server.log') `
        -RedirectStandardError (Join-Path $dataDirectory 'server-error.log')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 300
        try {
            $page = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 1
            if ($page.Content -like '*id="packingPrint"*') { $isRunning = $true; break }
        } catch {}
    }
}
if (!$isRunning) { throw 'Shipping workbench could not start. Check the local server-error.log.' }
if (!$NoBrowser) { Start-Process 'https://danny700808.github.io/play-card/portal.html#shipping' }
