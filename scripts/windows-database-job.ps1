param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$WorkerPath,
  [Parameter(Mandatory=$true)][string]$Directory,
  [Parameter(Mandatory=$true)][int]$Port,
  [Parameter(Mandatory=$true)][int]$OwnerPid
)
$ErrorActionPreference = 'Stop'
$owner = [System.Diagnostics.Process]::GetProcessById($OwnerPid)
$ownerHandle = $owner.Handle
try {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
public static class DatabaseJob {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved,desktop,title; public int x,y,xsize,ysize,xchars,ychars,fill,flags; public short show,reserved2; public IntPtr reservedPointer,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint processId,threadId; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref EXTENDED_LIMIT info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out ACCOUNTING info, uint size, IntPtr length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr ps, IntPtr ts, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok) { if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var b = new StringBuilder("\""); int slash = 0;
    foreach(char c in value) { if(c == '\\') { slash++; continue; } if(c == '"') b.Append('\\', slash * 2 + 1); else b.Append('\\', slash); slash=0; b.Append(c); }
    b.Append('\\',slash*2); b.Append('"'); return b.ToString();
  }
  public static int Run(string executable, string[] args, IntPtr owner) {
    IntPtr job=IntPtr.Zero; PROCESS_INFORMATION child=new PROCESS_INFORMATION();
    try {
      if(WaitForSingleObject(owner,0)!=0x102) return 1;
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
      var limit=new EXTENDED_LIMIT(); limit.basic.flags=0x2000;
      Check(SetInformationJobObject(job,9,ref limit,(uint)Marshal.SizeOf(limit)));
      var startup=new STARTUPINFO { cb=Marshal.SizeOf(typeof(STARTUPINFO)), flags=0x100, input=GetStdHandle(-10), output=GetStdHandle(-11), error=GetStdHandle(-12) };
      var command=new StringBuilder(Quote(executable)); foreach(var arg in args) command.Append(" ").Append(Quote(arg));
      Check(CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,null,ref startup,out child));
      if(!AssignProcessToJobObject(job,child.process)) { TerminateProcess(child.process,1); Check(false); }
      Check(ResumeThread(child.thread)!=0xffffffff);
      while(WaitForSingleObject(child.process,25)==0x102) {
        if(WaitForSingleObject(owner,0)!=0x102) { Check(TerminateJobObject(job,1)); break; }
      }
      uint code; Check(GetExitCodeProcess(child.process,out code));
      Check(TerminateJobObject(job,code));
      for(int n=0;n<400;n++) {
        ACCOUNTING accounting; Check(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero));
        if(accounting.active==0) return (int)code;
        Thread.Sleep(25);
      }
      throw new Exception("PostgreSQL process tree termination could not be confirmed");
    } finally {
      if(job!=IntPtr.Zero) CloseHandle(job);
      if(child.thread!=IntPtr.Zero) CloseHandle(child.thread);
      if(child.process!=IntPtr.Zero) CloseHandle(child.process);
    }
  }
}
'@
exit [DatabaseJob]::Run($NodePath, [string[]]@('--import', 'tsx', $WorkerPath, $Directory, [string]$Port), $ownerHandle)
} finally { $owner.Dispose() }
