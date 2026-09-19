param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$files = Get-ChildItem -LiteralPath $resolvedRoot -File -Recurse |
  Where-Object { $_.Name -ne 'hashes.json' } |
  Sort-Object FullName

$records = foreach ($file in $files) {
  $hash = Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
  [pscustomobject]@{
    path = [IO.Path]::GetRelativePath($resolvedRoot, $file.FullName)
    bytes = $file.Length
    sha256 = $hash.Hash.ToLowerInvariant()
  }
}

$records | ConvertTo-Json -Depth 4
