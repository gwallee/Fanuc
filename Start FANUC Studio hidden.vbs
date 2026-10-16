' Starts the FANUC TP Program Studio bridge with no console window and no
' browser tab. This is what the fanucstudio: link runs when the installed app
' offers "Start the bridge", and it is the file to point a Startup-folder
' shortcut at if the bridge should simply always be running.
' Stop it from the app (Robot tab, "Stop bridge") or end node.exe in Task
' Manager. Double-clicking "Start FANUC Studio.bat" still gives a console.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & dir & "\Start FANUC Studio.bat"" /nobrowser /quiet", 0, False
