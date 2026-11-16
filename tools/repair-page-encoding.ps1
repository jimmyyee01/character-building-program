# Repairs the double-encoded characters left by an earlier PowerShell round-trip
# in the three page shells, and leaves the menu caret to CSS.
# The search strings are built from character codes so this script itself never
# depends on how it is saved.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\MAMA TECH SOLUTIONS\AppData\Local\Cline\character-building-program'
$files = @('public\super.html', 'public\admin.html', 'public\app.html')

$a = [string][char]0x00E2
$mojCaret   = $a + [char]0x2013 + [char]0x00BE     # the broken triangle
$mojEmDash  = $a + [char]0x20AC + [char]0x201D     # the broken em dash
$mojEllips  = $a + [char]0x20AC + [char]0x00A6     # the broken ellipsis (â€¦)
$mojArrow   = $a + [char]0x2020                    # the broken left arrow
$emDash     = [string][char]0x2014
$ellipsis   = [string][char]0x2026
$arrow      = [string][char]0x2190

$utf8 = New-Object System.Text.UTF8Encoding($false)

foreach ($rel in $files) {
  $path = Join-Path $root $rel
  $txt = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  $before = $txt.Length
  $txt = $txt.Replace($mojCaret, '')
  $txt = $txt.Replace($mojEmDash, $emDash)
  $txt = $txt.Replace($mojEllips, $ellipsis)
  $txt = $txt.Replace($mojArrow, $arrow)
  # a stray C1 control can be left behind by the bad decode
  $txt = [regex]::Replace($txt, '[\u0080-\u009F]', '')
  # the same round-trip doubled some carriage returns
  $txt = [regex]::Replace($txt, '\r\r\n', "`r`n")
  [System.IO.File]::WriteAllText($path, $txt, $utf8)
  Write-Output ("repaired " + $rel + "  (" + $before + " -> " + $txt.Length + " chars)")
}
