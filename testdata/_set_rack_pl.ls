/PROG  _SET_RACK_PL
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Set Rack SlotPos";
PROG_SIZE	= 1495;
CREATE		= DATE 26-06-29  TIME 11:17:46;
MODIFIED	= DATE 26-08-24  TIME 15:10:38;
FILE_NAME	= TEST_SET;
VERSION		= 0;
LINE_COUNT	= 69;
MEMORY_SIZE	= 1987;
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
   1:  !*******SET RACK PLACE POS******* ;
   2:  LBL[100] ;
   3:  F[20:OFF:Rack PKPL-Set]=(OFF) ;
   4:  F[21:OFF:Rack Slot-Set]=(OFF) ;
   5:  R[20:*RackNum]=0    ;
   6:  R[25:*Slot-Colmn]=0    ;
   7:  R[26:*Slot-Row]=0    ;
   8:   ;
   9:  !**********Set Position********** ;
  10:  LBL[150] ;
  11:  IF (!DI[22:OFF:RackPL Rdy]),JMP LBL[700] ;
  12:  R[20:*RackNum]=GI[6:0:RackPL-Sectn]    ;
  13:  R[25:*Slot-Colmn]=GI[8:0:RackPL-Colmn]    ;
  14:  R[26:*Slot-Row]=GI[7:0:RackPL-Row]    ;
  15:   ;
  16:  IF (R[20:*RackNum]<>1 AND R[20:*RackNum]<>2 AND R[20:*RackNum]<>3),JMP LBL[404] ;
  17:  JMP LBL[200] ;
  18:   ;
  19:   ;
  20:  !*********Chk Place Pos********** ;
  21:  LBL[200] ;
  22:  F[21:OFF:Rack Slot-Set]=(OFF) ;
  23:  CALL _SET_RACK_SLOT    ;
  24:  IF (F[21:OFF:Rack Slot-Set]),JMP LBL[300] ;
  25:  JMP LBL[700] ;
  26:   ;
  27:   ;
  28:  !***Chk Slot Status Reg********** ;
  29:  LBL[300] ;
  30:  R[199:*RackSts-Reg]=R[21:*SlotNum]+200    ;
  31:  !Slot Status Should be <= 0 ;
  32:  IF (R[R[199]]>0),JMP LBL[700] ;
  33:  JMP LBL[400] ;
  34:   ;
  35:   ;
  36:  !*******Set Slot X/Z Offs******** ;
  37:  LBL[400] ;
  38:  R[22:*X-Offs]=((R[25:*Slot-Colmn]-1)*R[381:Rack-Colmn Offs]) ;
  39:  R[23:*Z-Offs]=((R[26:*Slot-Row]-1)*R[382:Rack-Row Offs]) ;
  40:   ;
  41:  !***Set Slot PR*** ;
  42:  PR[20:*Rack PKPL]=PR[R[27]]    ;
  43:  //PR[20,1:*Rack PKPL]=PR[R[27],1]+R[22:*X-Offs]    ;
  44:  PR[20,3:*Rack PKPL]=PR[R[27],3]+R[23:*Z-Offs]    ;
  45:   ;
  46:  !***Set Appr PR*** ;
  47:  PR[21:*Rack Appr]=PR[R[28]]    ;
  48:  JMP LBL[500] ;
  49:   ;
  50:   ;
  51:  !***********FUTURE USE*********** ;
  52:  LBL[500] ;
  53:  JMP LBL[900] ;
  54:   ;
  55:   ;
  56:  !***RACK PL NOT RDY************** ;
  57:  LBL[700] ;
  58:  F[20:OFF:Rack PKPL-Set]=(OFF) ;
  59:  F[21:OFF:Rack Slot-Set]=(OFF) ;
  60:  JMP LBL[999] ;
  61:   ;
  62:  !***RACK PL RDY****************** ;
  63:  LBL[900] ;
  64:  F[20:OFF:Rack PKPL-Set]=(ON) ;
  65:  F[21:OFF:Rack Slot-Set]=(OFF) ;
  66:  JMP LBL[999] ;
  67:   ;
  68:   ;
  69:  LBL[999] ;
/POS
/END
