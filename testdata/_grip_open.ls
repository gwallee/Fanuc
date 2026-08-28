/PROG  _GRIP_OPEN
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Grip-Full Open";
PROG_SIZE	= 983;
CREATE		= DATE 26-08-21  TIME 15:11:36;
MODIFIED	= DATE 26-08-21  TIME 15:11:36;
FILE_NAME	= _GRIP_PL;
VERSION		= 0;
LINE_COUNT	= 42;
MEMORY_SIZE	= 1455;
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
   1:  !*****FULL OPEN GRIP CLAMPS***** ;
   2:  LBL[100] ;
   3:  !**Chk Clamp/Hook Open Wait Tm ;
   4:  IF (R[394:GrpOpen-TmOut]<50),R[394:GrpOpen-TmOut]=(50) ;
   5:  IF (R[394:GrpOpen-TmOut]>300),R[394:GrpOpen-TmOut]=(100) ;
   6:  //CALL _SET_WAIT(R[394:GrpOpen-TmOut]) ;
   7:   ;
   8:  !***Raise Clamp, Open Hook*** ;
   9:  DO[66:OFF:Ret Clamp-Down]=OFF ;
  10:  DO[65:OFF:Ext Clamp-Up]=ON ;
  11:  DO[67:OFF:Ext Hook-Closed]=OFF ;
  12:  DO[68:OFF:Ret Hook-Open]=ON ;
  13:  WAIT (DI[65:OFF:Clamp Ext-Up] AND DI[68:ON :Hook Ret-Open]) TIMEOUT,LBL[700] ;
  14:  JMP LBL[999] ;
  15:   ;
  16:   ;
  17:  !***Errors*********************** ;
  18:  LBL[700] ;
  19:  IF (!DI[65:OFF:Clamp Ext-Up] AND !DI[68:ON :Hook Ret-Open]),JMP LBL[703] ;
  20:  IF (!DI[65:OFF:Clamp Ext-Up]),JMP LBL[701] ;
  21:  JMP LBL[702] ;
  22:  !**ERR-Clamps Not Full Open ;
  23:  LBL[701] ;
  24:  DO[49:OFF:Activate Alarm (SR)]=ON ;
  25:  PAUSE ;
  26:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
  27:  JMP LBL[100] ;
  28:  !**ERR-Hook Not Full Open ;
  29:  LBL[702] ;
  30:  DO[49:OFF:Activate Alarm (SR)]=ON ;
  31:  PAUSE ;
  32:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
  33:  JMP LBL[100] ;
  34:  !**ERR-Clamp & Hook Not Full Open ;
  35:  LBL[703] ;
  36:  DO[49:OFF:Activate Alarm (SR)]=ON ;
  37:  PAUSE ;
  38:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
  39:  JMP LBL[100] ;
  40:   ;
  41:   ;
  42:  LBL[999] ;
/POS
/END
