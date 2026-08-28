/PROG  _GRIP_PL
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Clamp-PL Tote";
PROG_SIZE	= 1165;
CREATE		= DATE 26-06-24  TIME 13:26:48;
MODIFIED	= DATE 26-07-15  TIME 15:00:34;
FILE_NAME	= _GRIP_PK;
VERSION		= 0;
LINE_COUNT	= 53;
MEMORY_SIZE	= 1593;
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
   1:  !*******UNCLAMP-DROP TOTE******** ;
   2:  LBL[100] ;
   3:  !**Chk Clamp/Hook Close Wait Tm ;
   4:  IF (R[394:GrpOpen-TmOut]<50),R[394:GrpOpen-TmOut]=(50) ;
   5:  IF (R[394:GrpOpen-TmOut]>300),R[394:GrpOpen-TmOut]=(100) ;
   6:  CALL _SET_WAIT(R[394:GrpOpen-TmOut]) ;
   7:   ;
   8:  !**Relax Hook Clamp ;
   9:  DO[67:OFF:Ext Hook-Closed]=OFF ;
  10:  WAIT    .10(sec) ;
  11:  !***Raise Clamp, Open Hook*** ;
  12:  DO[66:OFF:Ret Clamp-Down]=OFF ;
  13:  DO[65:OFF:Ext Clamp-Up]=ON ;
  14:  WAIT    .10(sec) ;
  15:  DO[67:OFF:Ext Hook-Closed]=OFF ;
  16:  DO[68:OFF:Ret Hook-Open]=ON ;
  17:  WAIT (DI[65:OFF:Clamp Ext-Up] AND DI[68:ON :Hook Ret-Open]) TIMEOUT,LBL[700] ;
  18:  JMP LBL[900] ;
  19:   ;
  20:   ;
  21:  !***Errors*********************** ;
  22:  LBL[700] ;
  23:  IF (!DI[65:OFF:Clamp Ext-Up] AND !DI[68:ON :Hook Ret-Open]),JMP LBL[703] ;
  24:  IF (!DI[65:OFF:Clamp Ext-Up]),JMP LBL[701] ;
  25:  JMP LBL[702] ;
  26:  !**ERR-Clamps Not Full Open ;
  27:  LBL[701] ;
  28:  DO[49:OFF:Activate Alarm (SR)]=ON ;
  29:  PAUSE ;
  30:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
  31:  JMP LBL[100] ;
  32:  !**ERR-Hook Not Full Open ;
  33:  LBL[702] ;
  34:  DO[49:OFF:Activate Alarm (SR)]=ON ;
  35:  PAUSE ;
  36:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
  37:  JMP LBL[100] ;
  38:  !**ERR-Clamp & Hook Not Full Open ;
  39:  LBL[703] ;
  40:  DO[49:OFF:Activate Alarm (SR)]=ON ;
  41:  PAUSE ;
  42:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
  43:  JMP LBL[100] ;
  44:   ;
  45:   ;
  46:  !***Tote Placed****************** ;
  47:  LBL[900] ;
  48:  R[6:*Payload ID]=1    ;
  49:  PAYLOAD[1:Empty] ;
  50:  JMP LBL[999] ;
  51:   ;
  52:   ;
  53:  LBL[999] ;
/POS
/END
