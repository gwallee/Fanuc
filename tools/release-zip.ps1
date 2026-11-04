param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('ExtractRuntime', 'CreateDistribution')]
    [string]$Action,
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$RuntimeFolder
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

if ($Action -eq 'ExtractRuntime') {
    # Extract only these two entries; npm and the rest of the SDK are unneeded.
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Source)
    try {
        foreach ($item in @(
            @{ Entry = "$RuntimeFolder/node.exe"; Name = 'node.exe' },
            @{ Entry = "$RuntimeFolder/LICENSE"; Name = 'NODE-LICENSE.txt' }
        )) {
            $entry = $archive.GetEntry($item.Entry)
            if ($null -eq $entry) { throw "Runtime archive is missing $($item.Entry)" }
            $target = Join-Path -Path $Destination -ChildPath $item.Name
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
        }
    } finally {
        $archive.Dispose()
    }
} else {
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $Source, $Destination, [System.IO.Compression.CompressionLevel]::Optimal, $true
    )
}
