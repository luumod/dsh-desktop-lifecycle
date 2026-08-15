param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('close', 'restart')]
    [string] $Action,

    [Parameter(Mandatory = $true)]
    [int] $DesktopPid,

    [Parameter(Mandatory = $true)]
    [string] $DesktopExecutable,

    [Parameter(Mandatory = $true)]
    [string] $LogPath
)

$ErrorActionPreference = 'Stop'

function Write-LifecycleLog([string] $Message) {
    $timestamp = [DateTime]::UtcNow.ToString('o')
    Add-Content -LiteralPath $LogPath -Value "$timestamp $Message" -Encoding UTF8
}

trap {
    Write-LifecycleLog "ERROR: $($_.Exception.Message)"
    exit 1
}

Write-LifecycleLog "helper started: action=$Action desktopPid=$DesktopPid helperPid=$PID"

# Let the HTTP response reach the browser before the process tree exits.
Start-Sleep -Milliseconds 350

# Verify the parent identity before any destructive process operation.
$expectedExecutable = [System.IO.Path]::GetFullPath($DesktopExecutable)
$desktopInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $DesktopPid"
if ($null -eq $desktopInfo) { throw 'The DeepSeek Harness desktop process no longer exists.' }
$actualExecutable = [System.IO.Path]::GetFullPath([string] $desktopInfo.ExecutablePath)
if (-not $actualExecutable.Equals($expectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The parent process is not the expected DeepSeek Harness executable.'
}
$actualCommandLine = ([string] $desktopInfo.CommandLine).Trim()
$expectedQuotedCommandLine = '"' + $expectedExecutable + '"'
if ($actualCommandLine -ne $expectedExecutable -and $actualCommandLine -ne $expectedQuotedCommandLine) {
    throw 'Refusing to treat a child or argument-bearing process as the desktop main process.'
}
Write-LifecycleLog 'desktop identity verified'

# Snapshot the Desktop tree and stop its descendants leaf-first before the
# main process. The helper is WMI-owned and normally outside this tree; the PID
# exclusion is a defensive guard if the launch topology changes.
$processes = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$childrenByParent = @{}
foreach ($process in $processes) {
    $parent = [int] $process.ParentProcessId
    if (-not $childrenByParent.ContainsKey($parent)) {
        $childrenByParent[$parent] = [System.Collections.Generic.List[int]]::new()
    }
    $childrenByParent[$parent].Add([int] $process.ProcessId)
}

$descendants = [System.Collections.Generic.List[int]]::new()
$queue = [System.Collections.Generic.Queue[int]]::new()
$queue.Enqueue($DesktopPid)
while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    if (-not $childrenByParent.ContainsKey($parent)) { continue }
    foreach ($childPid in $childrenByParent[$parent]) {
        $queue.Enqueue($childPid)
        if ($childPid -ne $PID) { $descendants.Add($childPid) }
    }
}

Write-LifecycleLog "stopping descendants: $($descendants -join ',')"
for ($index = $descendants.Count - 1; $index -ge 0; $index--) {
    Stop-Process -Id $descendants[$index] -Force -ErrorAction SilentlyContinue
}
Write-LifecycleLog 'descendants stopped'

$desktop = Get-Process -Id $DesktopPid -ErrorAction SilentlyContinue
if ($null -ne $desktop) {
    Stop-Process -Id $DesktopPid -Force
    if (-not $desktop.WaitForExit(5000)) {
        throw 'The DeepSeek Harness desktop process did not exit in time.'
    }
}
Write-LifecycleLog 'desktop stopped'

if ($Action -eq 'restart') {
    # Wait until the original PID is gone before reacquiring the single-instance lock.
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ((Get-Process -Id $DesktopPid -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
    if (Get-Process -Id $DesktopPid -ErrorAction SilentlyContinue) {
        throw 'The original desktop process is still running; restart cancelled.'
    }

    $existingMainPids = @(
        Get-CimInstance Win32_Process | Where-Object {
            if (-not $_.ExecutablePath) { return $false }
            $candidateExecutable = [System.IO.Path]::GetFullPath([string] $_.ExecutablePath)
            $candidateCommandLine = ([string] $_.CommandLine).Trim()
            $candidateQuotedCommandLine = '"' + $candidateExecutable + '"'
            return $candidateExecutable.Equals($expectedExecutable, [System.StringComparison]::OrdinalIgnoreCase) -and
                ($candidateCommandLine -eq $candidateExecutable -or $candidateCommandLine -eq $candidateQuotedCommandLine)
        } | ForEach-Object { [int] $_.ProcessId }
    )

    Write-LifecycleLog 'starting replacement desktop'
    $launched = Start-Process -FilePath $DesktopExecutable -PassThru
    Write-LifecycleLog "replacement launch returned pid=$($launched.Id)"
    $startupDeadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 250
        $newMain = Get-CimInstance Win32_Process | Where-Object {
            if (-not $_.ExecutablePath -or $existingMainPids -contains [int] $_.ProcessId) { return $false }
            $candidateExecutable = [System.IO.Path]::GetFullPath([string] $_.ExecutablePath)
            $candidateCommandLine = ([string] $_.CommandLine).Trim()
            $candidateQuotedCommandLine = '"' + $candidateExecutable + '"'
            return $candidateExecutable.Equals($expectedExecutable, [System.StringComparison]::OrdinalIgnoreCase) -and
                ($candidateCommandLine -eq $candidateExecutable -or $candidateCommandLine -eq $candidateQuotedCommandLine)
        } | Select-Object -First 1
    } while ($null -eq $newMain -and [DateTime]::UtcNow -lt $startupDeadline)

    if ($null -eq $newMain) { throw 'No new DeepSeek Harness desktop process appeared after restart.' }
    Write-LifecycleLog "replacement desktop verified: pid=$($newMain.ProcessId)"
}

Write-LifecycleLog 'helper completed'
