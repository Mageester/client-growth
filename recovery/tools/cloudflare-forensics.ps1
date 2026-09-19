param(
  [Parameter(Mandatory = $true)][string]$AccountId,
  [Parameter(Mandatory = $true)][string]$WorkerId,
  [Parameter(Mandatory = $true)][string]$VersionId,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [string]$OutputRoot = (Join-Path (Get-Location) 'recovery\evidence\cloudflare')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutputRoot, (Join-Path $OutputRoot 'responses'), (Join-Path $OutputRoot 'source-maps'), (Join-Path $OutputRoot 'content') | Out-Null

$toml = Get-Content -LiteralPath $ConfigPath -Raw
$tokenMatch = [regex]::Match($toml, '(?m)^\s*oauth_token\s*=\s*"([^"]+)"\s*$')
if (-not $tokenMatch.Success) {
  throw 'Wrangler OAuth token was not found in the configured profile.'
}
$token = $tokenMatch.Groups[1].Value
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/json, */*' }

$base = "https://api.cloudflare.com/client/v4/accounts/$AccountId"
$requests = @(
  @{ name = 'beta-version-include-modules'; uri = "$base/workers/workers/$WorkerId/versions/${VersionId}?include=modules"; output = 'responses\beta-version-include-modules.json' },
  @{ name = 'script-version-detail'; uri = "$base/workers/scripts/$WorkerId/versions/$VersionId"; output = 'responses\script-version-detail.json' },
  @{ name = 'script-content-v2'; uri = "$base/workers/scripts/$WorkerId/content/v2"; output = 'content\script-content-v2.bin' },
  @{ name = 'script-content'; uri = "$base/workers/scripts/$WorkerId/content"; output = 'content\script-content.bin' }
)

$results = foreach ($request in $requests) {
  $target = Join-Path $OutputRoot $request.output
  try {
    $response = Invoke-WebRequest -Uri $request.uri -Headers $headers -Method Get -UseBasicParsing -TimeoutSec 120
    [IO.File]::WriteAllBytes($target, $response.Content -is [byte[]] ? $response.Content : [Text.Encoding]::UTF8.GetBytes([string]$response.Content))
    [pscustomobject]@{
      name = $request.name
      method = 'GET'
      uri = $request.uri -replace [regex]::Escape($AccountId), '<account-id>'
      status = [int]$response.StatusCode
      contentType = [string]$response.Headers['Content-Type']
      bytes = (Get-Item -LiteralPath $target).Length
      output = $request.output
      error = $null
    }
  } catch {
    [pscustomobject]@{
      name = $request.name
      method = 'GET'
      uri = $request.uri -replace [regex]::Escape($AccountId), '<account-id>'
      status = $null
      contentType = $null
      bytes = 0
      output = $request.output
      error = $_.Exception.Message -replace [regex]::Escape($token), '<redacted-token>'
    }
  }
}

$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputRoot 'endpoint-results.json') -Encoding utf8
Remove-Variable token, headers, toml -ErrorAction SilentlyContinue
