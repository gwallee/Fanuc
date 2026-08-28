/PROG  _INIT_EOAT
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Init Grip Clamp";
PROG_SIZE	= 1575;
CREATE		= DATE 23-12-13  TIME 02:48:30;
MODIFIED	= DATE 26-08-04  TIME 21:09:26;
FILE_NAME	= _INIT_RE;
VERSION		= 0;
LINE_COUNT	= 70;
MEMORY_SIZE	= 2071;
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
   1:  !**********INIT EOAT*********** ;
   2:  LBL[100] ;
   3:  IF ((R[5:*Grp-ToteID]=0 AND R[100:*Tote-Sts ID]=0) AND !DO[65:OFF:Ext Clamp-Up] AND !DO[66:OFF:Ret Clamp-Down] AND !DO[67:OFF:Ext Hook-Closed] AND !DO[68:OFF:Ret Hook-Open]),JMP LBL[150] ;
   4:  IF (DO[65:OFF:Ext Clamp-Up] AND DO[68:OFF:Ret Hook-Open] AND DI[65:OFF:Clamp Ext-Up] AND DI[68:ON :Hook Ret-Open]),JMP LBL[200] ;
   5:  JMP LBL[300] ;
   6:   ;
   7:   ;
   8:  !***Power Cycle-Open Grip******** ;
   9:  LBL[150] ;
  10:  CALL _SET_WAIT(300) ;
  11:  DO[66:OFF:Ret Clamp-Down]=OFF ;
  12:  DO[65:OFF:Ext Clamp-Up]=ON ;
  13:  DO[67:OFF:Ext Hook-Closed]=OFF ;
  14:  DO[68:OFF:Ret Hook-Open]=ON ;
  15:  WAIT (DI[65:OFF:Clamp Ext-Up] AND DI[68:ON :Hook Ret-Open]) TIMEOUT,LBL[710] ;
  16:  R[5:*Grp-ToteID]=0    ;
  17:  R[100:*Tote-Sts ID]=0    ;
  18:  JMP LBL[999] ;
  19:   ;
  20:   ;
  21:  !***Opened*********************** ;
  22:  LBL[200] ;
  23:  R[5:*Grp-ToteID]=0    ;
  24:  R[100:*Tote-Sts ID]=0    ;
  25:  JMP LBL[900] ;
  26:   ;
  27:   ;
  28:  !***Closed*********************** ;
  29:  LBL[300] ;
  30:  !**Chk Tote ID ;
  31:  IF ((R[5:*Grp-ToteID]>=1 AND R[5:*Grp-ToteID]<=168) OR R[5:*Grp-ToteID]=200 OR R[5:*Grp-ToteID]=201),JMP LBL[310] ;
  32:  DO[51:OFF:Unknown ToteID]=ON ;
  33:  PAUSE ;
  34:  DO[51:OFF:Unknown ToteID]=OFF ;
  35:  JMP LBL[100] ;
  36:   ;
  37:  !**Chk Tote Status ID ;
  38:  LBL[310] ;
  39:  IF (R[100:*Tote-Sts ID]=10 OR R[100:*Tote-Sts ID]=11 OR R[100:*Tote-Sts ID]=20 OR R[100:*Tote-Sts ID]=25 OR R[100:*Tote-Sts ID]=30 OR R[100:*Tote-Sts ID]=35 OR R[100:*Tote-Sts ID]=40 OR R[100:*Tote-Sts ID]=50 OR 
    :  R[100:*Tote-Sts ID]=55),JMP LBL[350] ;
  40:  IF (R[100:*Tote-Sts ID]=60 OR R[100:*Tote-Sts ID]=70 OR R[100:*Tote-Sts ID]=71 OR R[100:*Tote-Sts ID]=72),JMP LBL[350] ;
  41:  DO[52:OFF:Unknown ToteSts]=ON ;
  42:  PAUSE ;
  43:  DO[52:OFF:Unknown ToteSts]=OFF ;
  44:  JMP LBL[100] ;
  45:   ;
  46:  !***Close Grip*** ;
  47:  LBL[350] ;
  48:  DO[65:OFF:Ext Clamp-Up]=OFF ;
  49:  DO[66:OFF:Ret Clamp-Down]=ON ;
  50:  DO[68:OFF:Ret Hook-Open]=OFF ;
  51:  DO[67:OFF:Ext Hook-Closed]=ON ;
  52:  JMP LBL[900] ;
  53:   ;
  54:   ;
  55:  !*************ERRORS************* ;
  56:  !**Gripper1 didn't open ;
  57:  LBL[710] ;
  58:  DO[49:OFF:Activate Alarm (SR)]=ON ;
  59:  PAUSE ;
  60:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
  61:  JMP LBL[100] ;
  62:   ;
  63:   ;
  64:  !*******SET ACTIVE PAYLOAD******* ;
  65:  LBL[900] ;
  66:  CALL _SET_PAYLOAD    ;
  67:  JMP LBL[999] ;
  68:   ;
  69:   ;
  70:  LBL[999] ;
/POS
/END
