/PROG  _SAFE
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Go to Safe Pos";
PROG_SIZE	= 691;
CREATE		= DATE 23-10-09  TIME 08:36:36;
MODIFIED	= DATE 26-07-13  TIME 10:59:02;
FILE_NAME	= _TOOL_MA;
VERSION		= 0;
LINE_COUNT	= 30;
MEMORY_SIZE	= 1091;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
LOCAL_REGISTERS	= 0,0,0;
/APPL

AUTO_SINGULARITY_HEADER;
  ENABLE_SINGULARITY_AVOIDANCE   : TRUE;
/MN
   1:  !***Go to Safe*** ;
   2:  LBL[100] ;
   3:  IF (DO[35:OFF:At Safe]),JMP LBL[999] ;
   4:  IF (F[1:ON :Part in Grip]),JMP LBL[800] ;
   5:  IF (DO[37:OFF:At Transit]),JMP LBL[200] ;
   6:  CALL _RECOVER    ;
   7:  JMP LBL[100] ;
   8:   ;
   9:  !**At Transit ;
  10:  LBL[200] ;
  11:  PR[6:*Transit]=PR[5:Trans-Origin]    ;
  12:  PR[6,1:*Transit]=0    ;
  13:J PR[6:*Transit] R[108:Transit Spd]% CNT25    ;
  14:  WAIT (DO[37:OFF:At Transit])    ;
  15:  JMP LBL[500] ;
  16:   ;
  17:  !**Move to Safe ;
  18:  LBL[500] ;
  19:J PR[3:Safe] 50% FINE    ;
  20:  WAIT (DO[35:OFF:At Safe])    ;
  21:  JMP LBL[999] ;
  22:   ;
  23:   ;
  24:  !***Part on: Go to TL Maint****** ;
  25:  LBL[800] ;
  26:  CALL _TOOL_MAINT    ;
  27:  JMP LBL[999] ;
  28:   ;
  29:   ;
  30:  LBL[999] ;
/POS
/END
