param(
  [string]$AppDir = "C:\Users\MAMA TECH SOLUTIONS\AppData\Local\Cline\character-building-program",
  [string]$Remote = "origin",
  [string]$Branch = "main",
  [switch]$ForcePush
)
# Pushes using the GitHub token already stored in Windows Credential Manager.
# The token is handed to git through an environment variable, so it is never
# written into .git/config, a remote URL, or this script's output.
$sig = @"
using System;
using System.Runtime.InteropServices;
public class CredReader2 {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32")] public static extern void CredFree(IntPtr cred);
}
"@
Add-Type -TypeDefinition $sig -ErrorAction Stop
$ptr = [IntPtr]::Zero
if (-not [CredReader2]::CredRead("git:https://github.com", 1, 0, [ref]$ptr)) {
  Write-Error "No stored GitHub credential found."
  exit 2
}
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredReader2+CREDENTIAL])
$user = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.UserName)
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
$token = [System.Text.Encoding]::Unicode.GetString($bytes)
[CredReader2]::CredFree($ptr)

$env:CBP_GIT_USER = $user
$env:CBP_GIT_TOKEN = $token
$helper = '!f() { echo "username=$CBP_GIT_USER"; echo "password=$CBP_GIT_TOKEN"; }; f'
$log = Join-Path $env:TEMP ("cbp-push-" + [guid]::NewGuid().ToString('N') + ".log")
Push-Location $AppDir
try {
  $env:GIT_TERMINAL_PROMPT = '0'
  $flag = ''
  if ($ForcePush) { $flag = ' --force-with-lease' }
  cmd /c "git -c credential.helper=`"$helper`" push$flag $Remote $Branch > `"$log`" 2>&1"
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:\CBP_GIT_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:\CBP_GIT_USER -ErrorAction SilentlyContinue
  Pop-Location
}
Write-Output "----- git output -----"
if (Test-Path $log) { Get-Content $log | ForEach-Object { $_ }; Remove-Item $log -Force }
Write-Output "----------------------"
if ($code -eq 0) { Write-Output "PUSH_OK" } else { Write-Output ("PUSH_FAILED exit=" + $code) }
exit $code
