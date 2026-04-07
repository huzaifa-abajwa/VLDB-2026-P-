# regenerate_contracts.ps1
# Run from project root: .\regenerate_contracts.ps1

$xmlDir = "XACML\XACML Policies"
$termsDir = "XACML\Terms"
$outputDir = "blockchain\contracts"
$generator = "blockchain\policies\array-receiving-contract.py"

$policies = @(
    "cox_model@2020",
    "German_Cancer_registry@2020",
    "google_Health_Cancer_Prediction_Model",
    "heart_failure_clinical_records_dataset",
    "kaplan_meier_model@2020",
    "lstm_readmission_model@2026",
    "mlp_cancer_classifier@2025",
    "National_Cancer_Registry_of_Pakistan",
    "Pima_Indians_Diabetes_USA",
    "random_survival_forest@2025",
    "SEER_Cancer_Registry_of_USA",
    "Sylhet_Diabetes_Hospital_Bangladesh",
    "UCI_diabetic_dataset",
    "UCI_AfricanAmerican_Readmission",
    "UCI_Caucasian_Readmission",
    "UCI_Hispanic_Readmission",
    "UCI_Asian_Readmission",
    "xgboost_risk_model@2025"
)

Write-Host "=== Regenerating all 18 smart contracts ===" -ForegroundColor Cyan

foreach ($name in $policies) {
    Write-Host "`nProcessing: $name" -ForegroundColor Yellow

    # Copy JSON terms next to XML (generator expects same directory)
    Copy-Item "$termsDir\$name.json" "$xmlDir\$name.json" -Force

    # Run generator
    python $generator "$xmlDir\$name.xml" $outputDir

    # Generator outputs name_with_underscores.sol (@ replaced in Python)
    # Move to smart-contract-name.sol format
    $solName = $name -replace "@", "_"
    $srcFile = "$outputDir\$name.sol"
    $dstFile = Join-Path $outputDir "smart-contract-$solName.sol"

    if (Test-Path $dstFile) { Remove-Item $dstFile -Force }
    if (Test-Path $srcFile) {
        Move-Item $srcFile $dstFile -Force
        Write-Host "  -> smart-contract-$solName.sol" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: $srcFile not generated!" -ForegroundColor Red
    }

    # Clean up copied JSON
    Remove-Item "$xmlDir\$name.json" -Force
}

Write-Host "`n=== Done. Now run: ===" -ForegroundColor Cyan
Write-Host "  cd blockchain" -ForegroundColor White
Write-Host "  npx hardhat run scripts/deployAutoNew.js --network sepolia" -ForegroundColor White
Write-Host "  # Copy new addresses into db_initialization_script/seed.js" -ForegroundColor White
Write-Host "  cd ..\backend" -ForegroundColor White
Write-Host "  node ..\db_initialization_script\seed.js" -ForegroundColor White