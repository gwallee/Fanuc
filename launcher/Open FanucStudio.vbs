' The FanucStudio shortcut: start the bridge hidden (after the signed update
' check) and open the app in the browser. Arguments are ignored.
Option Explicit
Dim fso, sh, dir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run """" & dir & "\bin\node.exe"" """ & dir & "\launcher.js"" --hidden --open", 0, False
