param(
  [int]$InterfaceIndex = 1,
  [string[]]$InterceptAddresses = @('185.180.13.135', '185.180.13.136')
)

$ErrorActionPreference = 'Stop'

$Interface = Get-NetIPInterface -InterfaceIndex $InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop
if ($Interface.InterfaceAlias -ne 'Loopback Pseudo-Interface 1') {
  throw "Refusing to add intercept IPs to InterfaceIndex $InterfaceIndex ($($Interface.InterfaceAlias)); expected Loopback Pseudo-Interface 1."
}

foreach ($Address in $InterceptAddresses) {
  $Existing = Get-NetIPAddress -IPAddress $Address -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceIndex -eq $InterfaceIndex }

  if ($Existing) {
    Write-Output "IP intercept already active: $Address on $($Interface.InterfaceAlias)"
    continue
  }

  New-NetIPAddress `
    -InterfaceIndex $InterfaceIndex `
    -IPAddress $Address `
    -PrefixLength 32 `
    -SkipAsSource $true | Out-Null

  Write-Output "IP intercept enabled: $Address/32 on $($Interface.InterfaceAlias)"
}

Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $InterceptAddresses -contains $_.IPAddress } |
  Select-Object IPAddress,InterfaceIndex,InterfaceAlias,PrefixLength,SkipAsSource,AddressState
