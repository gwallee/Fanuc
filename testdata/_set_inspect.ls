/PROG  _SET_INSPECT
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "";
PROG_SIZE	= 1475;
CREATE		= DATE 26-07-10  TIME 10:35:34;
MODIFIED	= DATE 26-07-24  TIME 23:35:34;
FILE_NAME	= _SET_SCA;
VERSION		= 0;
LINE_COUNT	= 62;
MEMORY_SIZE	= 1859;
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
   1:  !********SET INSPECT CHK********* ;
   2:  LBL[100] ;
   3:  F[45:OFF:PreInspect-Set]=(OFF) ;
   4:  R[396:*AR1]=AR[1]    ;
   5:   ;
   6:  !*******Chk EOAT/Tote Sts******** ;
   7:  LBL[200] ;
   8:  IF (!F[1:ON :Part in Grip]),JMP LBL[700] ;
   9:  !Jump for Pre/Post Chk ;
  10:  IF R[396:*AR1]=1,JMP LBL[210] ;
  11:  IF R[396:*AR1]=2,JMP LBL[220] ;
  12:  JMP LBL[700] ;
  13:   ;
  14:  !***Chk Pre-Inspct Rdy*********** ;
  15:  LBL[210] ;
  16:  IF (R[100:*Tote-Sts ID]<>20 AND R[100:*Tote-Sts ID]<>25 AND R[100:*Tote-Sts ID]<>30),JMP LBL[700] ;
  17:  IF (F[2:OFF:ToteOrig-Convs] AND R[386:Skip Pre-ConvPk]<>0),JMP LBL[211] ;
  18:  IF (F[3:OFF:ToteOrig-Racks] AND R[387:Skip Pre-RackPk]<>0),JMP LBL[211] ;
  19:  JMP LBL[300] ;
  20:  !**Skip Pre-Inspct Active ;
  21:  LBL[211] ;
  22:  R[100:*Tote-Sts ID]=35    ;
  23:  JMP LBL[700] ;
  24:   ;
  25:  !***Chk Post-Inspect Rdy********* ;
  26:  LBL[220] ;
  27:  IF (R[100:*Tote-Sts ID]<>40 AND R[100:*Tote-Sts ID]<>50),JMP LBL[700] ;
  28:  //IF ((DI[19:OFF:Outfd PL Rdy] OR DI[20:OFF:Recon PL Rdy]) AND R[388:Skip Post-ConvPL]<>0),JMP LBL[221] ;
  29:  //IF (DI[22:OFF:RackPL Rdy] AND R[389:Skip Post-RackPL]<>0),JMP LBL[221] ;
  30:  JMP LBL[300] ;
  31:  !**Skip Post-Inspct Active ;
  32:  LBL[221] ;
  33:  R[100:*Tote-Sts ID]=55    ;
  34:  JMP LBL[700] ;
  35:   ;
  36:   ;
  37:  !******Set/Chk Inspect Vars****** ;
  38:  LBL[300] ;
  39:  IF (R[46:CamDn-Wait Tm]<1),R[46:CamDn-Wait Tm]=(1) ;
  40:  IF (R[46:CamDn-Wait Tm]>5),R[46:CamDn-Wait Tm]=(5) ;
  41:  !Set TIMEOUT (WaitTm x 100) ;
  42:  R[47:*WaitTm x100]=R[46:CamDn-Wait Tm]*100    ;
  43:  JMP LBL[400] ;
  44:   ;
  45:   ;
  46:  !***********FUTURE USE*********** ;
  47:  LBL[400] ;
  48:  JMP LBL[900] ;
  49:   ;
  50:   ;
  51:  !***INSPECT NOT RDY************** ;
  52:  LBL[700] ;
  53:  F[45:OFF:PreInspect-Set]=(OFF) ;
  54:  JMP LBL[999] ;
  55:   ;
  56:  !***INSPECT RDY****************** ;
  57:  LBL[900] ;
  58:  F[45:OFF:PreInspect-Set]=(ON) ;
  59:  JMP LBL[999] ;
  60:   ;
  61:   ;
  62:  LBL[999] ;
/POS
/END
