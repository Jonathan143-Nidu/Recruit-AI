$content = Get-Content 'app\api\match\route.js' -Raw
$newAnalyze = Get-Content 'new_analyze.js' -Raw

$idx = $content.IndexOf("async function analyzeCandidate(")
if ($idx -ge 0) {
    $content = $content.Substring(0, $idx) + $newAnalyze
    Set-Content -Path 'app\api\match\route.js' -Value $content -NoNewline
    Write-Host "Success"
} else {
    Write-Host "Not found"
}
