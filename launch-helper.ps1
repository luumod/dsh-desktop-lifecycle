param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('close', 'restart')]
    [string] $Action,

    [Parameter(Mandatory = $true)]
    [int] $DesktopPid,

    [Parameter(Mandatory = $true)]
    [string] $DesktopExecutable,

    [Parameter(Mandatory = $true)]
    [string] $HelperPath,

    [Parameter(Mandatory = $true)]
    [string] $LogPath
)

$ErrorActionPreference = 'Stop'

# Win32_Process.Create is executed by the WMI provider, so the resulting helper
# is not a child of Desktop or Host and survives their process-tree cleanup.
foreach ($value in @($DesktopExecutable, $HelperPath, $LogPath)) {
    if ($value.Contains('"')) { throw 'Lifecycle paths must not contain a double quote.' }
}

$commandLine = 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass' +
    ' -File "' + $HelperPath + '"' +
    ' -Action ' + $Action +
    ' -DesktopPid ' + $DesktopPid +
    ' -DesktopExecutable "' + $DesktopExecutable + '"' +
    ' -LogPath "' + $LogPath + '"'

$startupClass = [WmiClass] 'Win32_ProcessStartup'
$startup = $startupClass.CreateInstance()
$startup.ShowWindow = 0

$processClass = [WmiClass] 'Win32_Process'
$result = $processClass.Create($commandLine, $null, $startup)
if ($result.ReturnValue -ne 0 -or $result.ProcessId -lt 1) {
    throw "Could not create independent lifecycle helper (WMI code $($result.ReturnValue))."
}

Write-Output $result.ProcessId
