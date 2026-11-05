# Project wish list

Reviewed 2026-11-05 against the main source folder. The separate development
checkout has its own implementation and release script.

## Open

- **Coordinate edits across Studio users.** Reserve a robot and program while
  someone edits it, show who holds the reservation, and require a valid
  reservation to upload. Allow a local draft or copy without a reservation,
  and make abandoned reservations expire. A shared bridge can coordinate its
  own users; separate bridges would need a shared coordination service, or a
  marker file on the controller (untested). Change detection (below) already
  stops one user's send from overwriting another's.
- **Verify the editor's in-use check on real controllers.** Test running and
  paused tasks, programs on their call stacks, pendant selection, background
  edit and unreadable reports across controller versions. `$TP_DEFPROG` is an
  indication of the pendant default, not a complete open-program test. An
  unavailable check currently shows no warning, so no warning is not proof the
  robot will accept the upload.
- **Consider editing more robot values.** A note in the separate development
  checkout proposes investigating SNPX for position registers, frames and
  reference positions, with controller testing, read-back and restore. Numeric
  `R[n]` values are already editable through ComSet; PR/SR values remain
  read-only in the current app. Confirm protocol and controller support before
  choosing an implementation.
- **Consider a native desktop wrapper or installer.** The portable ZIP and
  Chrome/Edge app installation are available; a native wrapper remains an
  optional idea.

## Completed

- **Detect changes before uploading.** The editor reads the robot's copy when
  editing begins; the bridge compares it with the robot's copy right before the
  STOR and sends nothing if they differ. A side-by-side diff shows what moved,
  the draft stays, and "Send anyway" overwrites with the usual snapshot. The
  remaining window is the one FTP command between the check and the STOR.
- **Autocomplete program names in the editor.** `CALL` and `RUN` suggest names
  and comments from the active library, including offline use and conditional
  calls. Enter, Tab or a click accepts a name while preserving existing arguments.
- **Warn before editing a program the robot may hold.** The editor checks
  live task state and the pendant default. It warns only when a task holds the
  program or the pendant default matches; editing remains available. The check
  was exercised against a mock robot and still needs the hardware verification
  listed above.
- **Hide the program library in the Flow tab.** Flow has its own remembered
  Hide library control; the header also has a separate global library toggle.
- **Edit numeric register values.** Live `R[n]` writes use ComSet with
  confirmation and a read-back from `NUMREG.VA`.
- **Build a portable Windows distribution.** The distribution builder packages
  the app with a pinned, checksum-verified Node runtime and excludes robot data,
  backups and the separate development checkout. `Build Distribution.bat` provides
  double-click builds; a verified cached runtime supports offline rebuilds.
  Distribution verification used build 131: the extracted app, all linked assets,
  all three test suites under the bundled runtime, and offline/failure checks.
  The ZIP must be rebuilt after every build bump; a ZIP's `build-info.json`
  says which build it carries.
- **Show robot info and installed options.** `VERSION.DG` (or `SUMMARY.DG`)
  is read on connect and from opened backups: model, robot number, software,
  serial and controller ID, firmware details, and a searchable installed
  options list with demo features kept separate.
