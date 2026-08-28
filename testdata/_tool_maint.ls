/PROG  _TOOL_MAINT
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Go to TL Maint";
PROG_SIZE	= 531;
CREATE		= DATE 22-11-19  TIME 01:39:20;
MODIFIED	= DATE 26-07-13  TIME 11:00:46;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 22;
MEMORY_SIZE	= 955;
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
   1:  !***Go to Tool Maint*** ;
   2:  LBL[100] ;
   3:  IF (DO[34:OFF:At TL Maint]),JMP LBL[999] ;
   4:  IF (DO[37:OFF:At Transit]),JMP LBL[200] ;
   5:  CALL _RECOVER    ;
   6:  JMP LBL[100] ;
   7:   ;
   8:  !**At Transit ;
   9:  LBL[200] ;
  10:  PR[6:*Transit]=PR[5:Trans-Origin]    ;
  11:  PR[6,1:*Transit]=0    ;
  12:J PR[6:*Transit] R[108:Transit Spd]% CNT25    ;
  13:  WAIT (DO[37:OFF:At Transit])    ;
  14:  JMP LBL[500] ;
  15:   ;
  16:  !**Move to TL Maint ;
  17:  LBL[500:Move to TL Maint] ;
  18:J PR[2:TL Maint] 50% FINE    ;
  19:  WAIT (DO[34:OFF:At TL Maint])    ;
  20:   ;
  21:   ;
  22:  LBL[999] ;
/POS
/END
