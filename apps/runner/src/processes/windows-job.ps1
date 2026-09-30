param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
public static class VibeJob {
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public bool inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved; public string desktop; public string title; public int x,y,xsize,ysize,xchars,ychars,fill,flags; public short show,reserved2; public IntPtr reservedPointer,input,output,error; }
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
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string path, uint access, uint share, ref SECURITY_ATTRIBUTES security, uint creation, uint attributes, IntPtr template);
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
  public static int Run(string executable, string[] args, string cwd, string input, string output, string error, uint timeout, int parentPid) {
    IntPtr job=IntPtr.Zero,stdin=IntPtr.Zero,stdout=IntPtr.Zero,stderr=IntPtr.Zero; PROCESS_INFORMATION process=new PROCESS_INFORMATION();
    var owner=System.Diagnostics.Process.GetProcessById(parentPid);
    try {
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
      var limit=new EXTENDED_LIMIT(); limit.basic.flags=0x2000; Check(SetInformationJobObject(job,9,ref limit,(uint)Marshal.SizeOf(limit)));
      var security=new SECURITY_ATTRIBUTES { length=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), inherit=true };
      stdin=CreateFile(input,0x80000000,1,ref security,3,0,IntPtr.Zero); Check(stdin.ToInt64()!=-1);
      stdout=CreateFile(output,0x40000000,1,ref security,2,0,IntPtr.Zero); Check(stdout.ToInt64()!=-1);
      stderr=CreateFile(error,0x40000000,1,ref security,2,0,IntPtr.Zero); Check(stderr.ToInt64()!=-1);
      var startup=new STARTUPINFO { cb=Marshal.SizeOf(typeof(STARTUPINFO)), flags=0x100, input=stdin, output=stdout, error=stderr };
      var command=new StringBuilder(Quote(executable)); foreach(var arg in args) command.Append(" ").Append(Quote(arg));
      Check(CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out process));
      if(!AssignProcessToJobObject(job,process.process)) { TerminateProcess(process.process,1); Check(false); }
      Check(ResumeThread(process.thread)!=0xffffffff);
      var clock=System.Diagnostics.Stopwatch.StartNew();
      bool timedOut=false, interrupted=false;
      while(WaitForSingleObject(process.process,25)==0x102) {
        if(owner.HasExited) { interrupted=true; break; }
        if(clock.ElapsedMilliseconds>=timeout) { timedOut=true; break; }
      }
      uint code; Check(GetExitCodeProcess(process.process,out code));
      Check(TerminateJobObject(job,timedOut ? 124u : code));
      for(int n=0;n<200;n++) { ACCOUNTING accounting; Check(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero)); if(accounting.active==0) return interrupted ? 125 : timedOut ? 124 : (int)code; Thread.Sleep(25); }
      throw new Exception("Process tree termination could not be confirmed");
    } finally { owner.Dispose(); if(job!=IntPtr.Zero) CloseHandle(job); if(process.thread!=IntPtr.Zero) CloseHandle(process.thread); if(process.process!=IntPtr.Zero) CloseHandle(process.process); if(stdin!=IntPtr.Zero) CloseHandle(stdin); if(stdout!=IntPtr.Zero) CloseHandle(stdout); if(stderr!=IntPtr.Zero) CloseHandle(stderr); }
  }
}
'@
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$code = [VibeJob]::Run($config.executable, [string[]]$config.arguments, $config.cwd, $config.input, $config.output, $config.error, $config.timeoutMs, $config.parentPid)
Write-Output $code
