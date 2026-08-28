/PROG  _ZERO
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Go to Zero Pos";
PROG_SIZE	= 557;
CREATE		= DATE 23-10-09  TIME 08:38:24;
MODIFIED	= DATE 26-07-13  TIME 11:02:26;
FILE_NAME	= _SAFE;
VERSION		= 0;
LINE_COUNT	= 23;
MEMORY_SIZE	= 977;
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
   1:  !***Go to Zero*** ;
   2:  LBL[100] ;
   3:  IF (F[1:ON :Part in Grip]),JMP LBL[999] ;
   4:  IF (DO[36:OFF:At Zero]),JMP LBL[999] ;
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
  17:  !**Move to Zero ;
  18:  LBL[500] ;
  19:J PR[4:Zero] 50% FINE    ;
  20:  WAIT (DO[36:OFF:At Zero])    ;
  21:   ;
  22:   ;
  23:  LBL[999] ;
/POS
/END
