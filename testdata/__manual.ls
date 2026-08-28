/PROG  __MANUAL
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Manual Task Loop";
PROG_SIZE	= 847;
CREATE		= DATE 23-10-17  TIME 11:37:40;
MODIFIED	= DATE 23-10-17  TIME 11:37:40;
FILE_NAME	= __MANUAL;
VERSION		= 0;
LINE_COUNT	= 34;
MEMORY_SIZE	= 1375;
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
  ENABLE_SINGULARITY_AVOIDANCE   : FALSE;
/MN
   1:  !***Ver:P-00, 2022-02-28, DG*** ;
   2:  !Manual Mode Loop ;
   3:   ;
   4:  !***WAIT FOR TASK ;
   5:  LBL[100] ;
   6:  DO[1:OFF:Auto Mode Echo]=OFF ;
   7:  IF DI[1:ON :Auto Mode]=ON,JMP LBL[998] ;
   8:  IF ((DI[5:OFF:Run Task] AND GI[1:0:Task ID]>0) OR DI[4:OFF:RTE]),JMP LBL[150] ;
   9:  DO[5:OFF:Task Done]=OFF ;
  10:  WAIT    .10(sec) ;
  11:  JMP LBL[100] ;
  12:   ;
  13:  !***EXECUTE TASK ;
  14:  LBL[150] ;
  15:  R[2:Manual TaskID]=GI[1:0:Task ID]    ;
  16:  GO[1:0:Robot TaskID]=(R[2:Manual TaskID]) ;
  17:   ;
  18:  !**Standard Tasks ;
  19:  IF (R[2:Manual TaskID]=10),CALL _RECOVER ;
  20:  IF (R[2:Manual TaskID]=20),CALL _TOOL_MAINT ;
  21:  IF (R[2:Manual TaskID]=30 OR DI[4:OFF:RTE]),CALL _SAFE ;
  22:  IF (R[2:Manual TaskID]=40),CALL _ZERO ;
  23:   ;
  24:  !***TASK COMPLETE ;
  25:  DO[5:OFF:Task Done]=ON ;
  26:  WAIT DI[5:OFF:Run Task]=OFF    ;
  27:  R[3:Prev-TaskID]=R[2:Manual TaskID]    ;
  28:  DO[5:OFF:Task Done]=OFF ;
  29:  R[2:Manual TaskID]=0    ;
  30:  GO[1:0:Robot TaskID]=0 ;
  31:  JMP LBL[100] ;
  32:   ;
  33:  LBL[998] ;
  34:  CALL _RECOVER    ;
/POS
/END
