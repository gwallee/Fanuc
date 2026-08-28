/PROG  _SET_PAYLOAD
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Save Speed Vars";
PROG_SIZE	= 681;
CREATE		= DATE 23-12-13  TIME 02:36:10;
MODIFIED	= DATE 26-07-15  TIME 14:58:52;
FILE_NAME	= _SET_SPD;
VERSION		= 0;
LINE_COUNT	= 27;
MEMORY_SIZE	= 1077;
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
   1:  !**********SET PAYLOAD*********** ;
   2:  LBL[100] ;
   3:  IF (!F[1:ON :Part in Grip]),JMP LBL[200] ;
   4:  JMP LBL[300] ;
   5:   ;
   6:   ;
   7:  !***TOOL EMPTY******************* ;
   8:  LBL[200] ;
   9:  R[6:*Payload ID]=1    ;
  10:  JMP LBL[900] ;
  11:   ;
  12:   ;
  13:  !***PROJECTILE ON TOOL*********** ;
  14:  LBL[300] ;
  15:  R[6:*Payload ID]=2    ;
  16:  JMP LBL[900] ;
  17:   ;
  18:   ;
  19:  !******SET ACTIVE PAYLOAD******* ;
  20:  LBL[900] ;
  21:  R[6:*Payload ID]=R[6:*Payload ID] DIV 1    ;
  22:  IF (R[6:*Payload ID]<1 OR R[6:*Payload ID]>2),R[6:*Payload ID]=(2) ;
  23:  PAYLOAD[R[6]] ;
  24:  JMP LBL[999] ;
  25:   ;
  26:   ;
  27:  LBL[999] ;
/POS
/END
