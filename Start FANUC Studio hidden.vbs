' Starts the FANUC Studio bridge with no console window.
'
' This is what the app's "Start bridge" button runs, through the
' fanucstudio:// link that "Start FANUC Studio.bat" registers (per user, no
' admin). Double-clicking it works too.
'
' Arguments are ignored on purpose: any web page can open a fanucstudio://
' link, so the link may start the bridge and nothing else - it never passes
' anything through to node.
'
' Output goes to bridge.log beside this file. A second start while the
' bridge is already running just exits (server.js sees the port in use).
' To stop a hidden bridge: Task Manager -> node.exe.
Option Explicit
Dim fso, sh, dir, node
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

' portable builds ship their own Node; otherwise use the installed one
node = dir & "\runtime\node.exe"
If Not fso.FileExists(node) Then node = "node"

sh.CurrentDirectory = dir
' cmd /c ""<node>" server.js > bridge.log 2>&1"  - window style 0 = hidden
sh.Run "cmd /c """"" & node & """ server.js > bridge.log 2>&1""", 0, False
