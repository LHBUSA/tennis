# Run SQL on the PropBetEdge SPORTS Supabase project (tkmln) through the Management API, using the
# Supabase CLI's stored access token (Windows Credential Manager "Supabase CLI:supabase"). The token is
# never printed. Pattern from LHBUSA/UFC scripts/db/run_sql.ps1.
#
#   pwsh scripts/db/run_sql.ps1 -Query "select 1"
#   pwsh scripts/db/run_sql.ps1 -File supabase/migrations/x.sql
#   pwsh scripts/db/run_sql.ps1 -ReloadSchema
param([string]$Query = "", [string]$File = "", [switch]$ReloadSchema)
$ErrorActionPreference = "Stop"
# UTF-8 out: a piped stdout otherwise uses the legacy console codepage and turns non-ASCII (e.g. the Match DNA label
# arrow U+2192) into 0x1A SUB bytes in every consumer (2026-10-02: misread as corrupt frozen packets).
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$sig = @'
using System; using System.Runtime.InteropServices;
public class TennisCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) { IntPtr p; if (!CredRead(target, 1, 0, out p)) return null; var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return System.Text.Encoding.UTF8.GetString(b); }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'TennisCred').Type) { Add-Type -TypeDefinition $sig }
$tok = [TennisCred]::Read("Supabase CLI:supabase")
if (-not $tok) { throw "Supabase CLI token not found" }
$ref = "tkmlnhmylqnttmnsnief"   # sports intelligence project (never rlfy)

if ($ReloadSchema) { $Query = "notify pgrst, 'reload schema';" }
if ($File) { $Query = Get-Content -Raw -Encoding UTF8 $File }
if (-not $Query) { throw "Pass -Query, -File or -ReloadSchema" }

$payload = @{ query = $Query } | ConvertTo-Json -Depth 3 -Compress
try {
  $r = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
  if ($null -eq $r) { "(empty result)" } else { $r | ConvertTo-Json -Depth 6 }
} catch {
  $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
  "FAILED -> $msg"
  exit 1
}
