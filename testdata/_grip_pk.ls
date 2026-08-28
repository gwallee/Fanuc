/PROG  _GRIP_PK
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Clamp-PK Tote";
PROG_SIZE	= 1207;
CREATE		= DATE 26-06-24  TIME 13:10:34;
MODIFIED	= DATE 26-08-25  TIME 10:30:40;
FILE_NAME	= _GRIP_CL;
VERSION		= 0;
LINE_COUNT	= 54;
MEMORY_SIZE	= 1631;
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
   1:  !********CLAMP-GRIP TOTE********* ;
   2:  LBL[100] ;
   3:  CALL _SET_WAIT(300) ;
   4:   ;
   5:  !**Chk Clamp/Hook Close Wait Tm ;
   6:  IF (R[392:ClampCls-WaitTm]<.5),R[392:ClampCls-WaitTm]=(.5) ;
   7:  IF (R[392:ClampCls-WaitTm]>3),R[392:ClampCls-WaitTm]=(1) ;
   8:  IF (R[393:HookCls-WaitTm]<.25),R[393:HookCls-WaitTm]=(.25) ;
   9:  IF (R[393:HookCls-WaitTm]>3),R[393:HookCls-WaitTm]=(1) ;
  10:   ;
  11:  !***Lower Vert Clamp*** ;
  12:  DO[65:OFF:Ext Clamp-Up]=OFF ;
  13:  DO[66:OFF:Ret Clamp-Down]=ON ;
  14:  WAIT R[392] ;
  15:  IF (DI[65:OFF:Clamp Ext-Up] OR DI[66:OFF:Clamp Full Ret]),JMP LBL[701] ;
  16:  !**Relax Vert Clamp ;
  17:  //WAIT    .10(sec) ;
  18:  DO[66:OFF:Ret Clamp-Down]=OFF ;
  19:  //WAIT    .25(sec) ;
  20:  !***Close Hook Clamp*** ;
  21:  DO[68:OFF:Ret Hook-Open]=OFF ;
  22:  DO[67:OFF:Ext Hook-Closed]=ON ;
  23:  WAIT R[393] ;
  24:  //IF (DI[67:OFF:Hook Full Close]),JMP LBL[702] ;
  25:  !**Energize Vert Clamp ;
  26:  DO[66:OFF:Ret Clamp-Down]=ON ;
  27:  //WAIT    .10(sec) ;
  28:  JMP LBL[900] ;
  29:   ;
  30:   ;
  31:  !***Errors*********************** ;
  32:  LBL[700] ;
  33:  !**ERR-Clamp Full Cls or Open ;
  34:  LBL[701] ;
  35:  DO[49:OFF:Activate Alarm (SR)]=ON ;
  36:  PAUSE ;
  37:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
  38:  JMP LBL[100] ;
  39:  !***ERR-Hook Not Full Cls*** ;
  40:  LBL[702] ;
  41:  DO[49:OFF:Activate Alarm (SR)]=ON ;
  42:  PAUSE ;
  43:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
  44:  JMP LBL[100] ;
  45:   ;
  46:   ;
  47:  !***Tote Picked****************** ;
  48:  LBL[900] ;
  49:  R[6:*Payload ID]=2    ;
  50:  PAYLOAD[2:Heavy Tote] ;
  51:  JMP LBL[999] ;
  52:   ;
  53:   ;
  54:  LBL[999] ;
/POS
/END
