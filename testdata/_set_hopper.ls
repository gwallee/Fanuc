/PROG  _SET_HOPPER
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "";
PROG_SIZE	= 1255;
CREATE		= DATE 26-07-13  TIME 09:46:48;
MODIFIED	= DATE 26-07-25  TIME 02:11:50;
FILE_NAME	= _SET_CON;
VERSION		= 0;
LINE_COUNT	= 58;
MEMORY_SIZE	= 1655;
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
   1:  !******SET HOPPER DUMP POS****** ;
   2:  LBL[100] ;
   3:  F[40:OFF:Hopper-Set]=(OFF) ;
   4:  R[40:*Hopper-Pos]=0    ;
   5:   ;
   6:   ;
   7:  !***Set/Chk Hopper Vars********** ;
   8:  LBL[150] ;
   9:  IF (R[41:DumpDn-WaitTm]<6),R[41:DumpDn-WaitTm]=(6) ;
  10:  IF (R[41:DumpDn-WaitTm]>60),R[41:DumpDn-WaitTm]=(30) ;
  11:  R[42:*WaitTm x100]=R[41:DumpDn-WaitTm]*100    ;
  12:  JMP LBL[200] ;
  13:   ;
  14:   ;
  15:  !***Chk EOAT/Hopper************** ;
  16:  LBL[200] ;
  17:  IF (!DI[23:OFF:Hopper Rdy]),JMP LBL[700] ;
  18:  IF (!F[1:ON :Part in Grip]),JMP LBL[700] ;
  19:  IF (R[100:*Tote-Sts ID]=30 OR R[100:*Tote-Sts ID]=35),JMP LBL[300] ;
  20:  IF (R[100:*Tote-Sts ID]=50 OR R[100:*Tote-Sts ID]=55),JMP LBL[300] ;
  21:  JMP LBL[700] ;
  22:   ;
  23:   ;
  24:  !***Set Hopper Pos*************** ;
  25:  LBL[300] ;
  26:  IF (DI[25:OFF:Divided Tote]),JMP LBL[320] ;
  27:  JMP LBL[310] ;
  28:   ;
  29:  !***Dump Pos-Nrml*** ;
  30:  LBL[310] ;
  31:  R[40:*Hopper-Pos]=1    ;
  32:  PR[40:*Hopper Pos]=PR[43:Orig-Hopper-Nrml]    ;
  33:  JMP LBL[400] ;
  34:   ;
  35:  !***Dump Pos-Divided Tote*** ;
  36:  LBL[320] ;
  37:  R[40:*Hopper-Pos]=2    ;
  38:  PR[40:*Hopper Pos]=PR[44:Orig-Hopper-Div]    ;
  39:  JMP LBL[400] ;
  40:   ;
  41:   ;
  42:  !***********FUTURE USE*********** ;
  43:  LBL[400] ;
  44:  JMP LBL[900] ;
  45:   ;
  46:   ;
  47:  !***HOPPER NOT RDY*************** ;
  48:  LBL[700] ;
  49:  F[40:OFF:Hopper-Set]=(OFF) ;
  50:  JMP LBL[999] ;
  51:   ;
  52:  !***HOPPER RDY******************* ;
  53:  LBL[900] ;
  54:  F[40:OFF:Hopper-Set]=(ON) ;
  55:  JMP LBL[999] ;
  56:   ;
  57:   ;
  58:  LBL[999] ;
/POS
/END
