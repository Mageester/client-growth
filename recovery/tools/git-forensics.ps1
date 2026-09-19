param(
  [string]$RepoRoot = (Get-Location).Path,
  [string]$OutputRoot = (Join-Path (Get-Location) 'recovery\evidence\github')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutputRoot, (Join-Path $OutputRoot 'candidates'), (Join-Path (Split-Path $OutputRoot) 'local-git') | Out-Null

function Invoke-GitText([string[]]$Arguments) {
  $output = & git -C $RepoRoot @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join "`n")" }
  return @($output)
}

$refs = Invoke-GitText @('for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/github')
$refs | Set-Content -LiteralPath (Join-Path $OutputRoot 'branch-commits.txt') -Encoding utf8
Invoke-GitText @('branch', '-a', '--no-color') | Set-Content -LiteralPath (Join-Path $OutputRoot 'remote-branches.txt') -Encoding utf8
Invoke-GitText @('rev-list', '--all', '--objects') | Set-Content -LiteralPath (Join-Path (Split-Path $OutputRoot) 'local-git\rev-list-all-objects.txt') -Encoding utf8

$candidateNames = @(
  'CloudflareVisualCapture.ts', 'DeepSeekVisualCritic.ts', 'DeepSeekVisualReviewer.ts',
  'DeepSeekSiteUnderstanding.ts', 'DeepSeekInsightCritic.ts', 'visualScreenshots.ts',
  'visual-review.server.ts', 'analysisLifecycle.ts', 'providerPricing.ts', 'providerUsage.ts',
  'provider-usage.server.ts', 'problemSynthesis.ts', 'semanticDrafts.ts', 'insightSnapshot.ts',
  'findingSchema.ts', 'claimBinding.ts', 'findingPublication.ts'
)
$symbolPatterns = @(
  'CloudflareVisualCapture', 'DeepSeekVisualCritic', 'DeepSeekVisualReviewer',
  'DeepSeekSiteUnderstanding', 'DeepSeekInsightCritic', 'visualScreenshots',
  'analysisLifecycle', 'providerPricing', 'providerUsage', 'problemSynthesis',
  'semanticDrafts', 'insightSnapshot', 'findingSchema', 'claimBinding', 'findingPublication',
  'DEEPSEEK_VISION_MODEL', 'deepseek-flash'
)

$candidateRows = [System.Collections.Generic.List[object]]::new()
$objectLines = Invoke-GitText @('rev-list', '--objects', '--remotes=github')
foreach ($line in $objectLines) {
  if ($line -notmatch '^(?<object>[0-9a-f]+)\s+(?<path>.+)$') { continue }
  $path = $Matches.path
  if ($candidateNames -contains ([IO.Path]::GetFileName($path))) {
    $objectType = [string](& git -C $RepoRoot cat-file -t $Matches.object 2>$null)
    if ($objectType -eq 'blob') {
      $candidateRows.Add([pscustomobject]@{
        source = 'github-reachable-object'
        path = $path
        object = $Matches.object
        bytes = [int64](& git -C $RepoRoot cat-file -s $Matches.object)
      })
    }
  }
}
if ($candidateRows.Count -eq 0) { '[]' | Set-Content -LiteralPath (Join-Path $OutputRoot 'candidate-files.json') -Encoding utf8 }
else { $candidateRows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputRoot 'candidate-files.json') -Encoding utf8 }

$symbolHits = [System.Collections.Generic.List[object]]::new()
foreach ($pattern in $symbolPatterns) {
  $hits = & git -C $RepoRoot log --remotes=github --oneline --full-history -S $pattern -- 2>$null
  foreach ($hit in @($hits)) {
    if ($hit) { $symbolHits.Add([pscustomobject]@{ pattern = $pattern; hit = [string]$hit }) }
  }
}
if ($symbolHits.Count -eq 0) { '[]' | Set-Content -LiteralPath (Join-Path $OutputRoot 'symbol-history.json') -Encoding utf8 }
else { $symbolHits | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputRoot 'symbol-history.json') -Encoding utf8 }

$commitRows = foreach ($refRow in $refs) {
  $parts = $refRow -split ' ', 2
  $ref = $parts[0]
  $log = Invoke-GitText @('log', '-1', '--format=%H%x09%aI%x09%an%x09%s', $ref) | Select-Object -First 1
  $logParts = [string]$log -split "`t", 4
  [pscustomobject]@{ ref = $ref; tip = $parts[1]; commit = $logParts[0]; authored = $logParts[1]; author = $logParts[2]; subject = $logParts[3] }
}
$commitRows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputRoot 'branch-commits.json') -Encoding utf8
