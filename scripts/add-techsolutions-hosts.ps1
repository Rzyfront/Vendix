# FIX QUI-TIENDA-ONLINE: agrega subdominios de Tech Solutions a hosts de Windows
# Ejecutar como Administrador.

$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$entries = @(
    "",
    "# FIX QUI-TIENDA-ONLINE: subdominios de Tech Solutions (dev)",
    "127.0.0.1 tienda-techsolutions.vendix.com",
    "127.0.0.1 admin-tienda-techsolutions.vendix.com",
    "127.0.0.1 techsolutions.vendix.com",
    "127.0.0.1 admin-techsolutions.vendix.com"
)
Add-Content -Path $hostsPath -Value ($entries -join "`r`n")
Write-Host "OK: entradas agregadas a $hostsPath"
