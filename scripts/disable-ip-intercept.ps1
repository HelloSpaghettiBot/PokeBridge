param(
  [int]$InterfaceIndex = 1,
  [string[]]$InterceptAddresses = @('185.180.13.135', '185.180.13.136')
)

$ErrorActionPreference = 'Stop'

foreach ($Address in $InterceptAddresses) {
  $Existing = Get-NetIPAddress -IPAddress $Address -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceIndex -eq $InterfaceIndex }

  if (-not $Existing) {
    Write-Output "IP intercept not present: $Address"
    continue
  }

  foreach ($Entry in $Existing) {
    Remove-NetIPAddress -InputObject $Entry -Confirm:$false
    Write-Output "IP intercept removed: $Address from $($Entry.InterfaceAlias)"
  }
}
