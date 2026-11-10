' Starts the FanucStudio bridge with no window (installed copy).
'
' This is what the app's "Start bridge" button runs, through the
' fanucstudio:// link the launcher registers (per user, no admin).
' Arguments are ignored on purpose: any web page can open a fanucstudio://
' link, so the link may start the bridge and nothing else.
'
' The launcher checks the share for a signed update, verifies the local
' copy, starts the bridge hidden and logs to state\bridge.log.
Option Explicit
Dim fso, sh, dir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run """" & dir & "\bin\node.exe"" """ & dir & "\launcher.js"" --hidden", 0, False
