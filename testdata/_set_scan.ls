/PROG  _SET_SCAN
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "";
PROG_SIZE	= 1183;
CREATE		= DATE 26-07-10  TIME 09:59:38;
MODIFIED	= DATE 26-07-15  TIME 14:13:40;
FILE_NAME	= _SET_CON;
VERSION		= 0;
LINE_COUNT	= 49;
MEMORY_SIZE	= 1619;
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
   1:  !********SET BARCODE SCAN******** ;
   2:  LBL[100] ;
   3:  F[35:OFF:BC Scan-Set]=(OFF) ;
   4:   ;
   5:   ;
   6:  !*******Chk EOAT/Tote Sts******** ;
   7:  LBL[200] ;
   8:  IF (!F[1:ON :Part in Grip]),JMP LBL[700] ;
   9:  IF (R[100:*Tote-Sts ID]<>10 AND R[100:*Tote-Sts ID]<>11 AND R[100:*Tote-Sts ID]<>60 AND R[100:*Tote-Sts ID]<>61),JMP LBL[700] ;
  10:  !Chk for Scan Skip ;
  11:  IF (R[100:*Tote-Sts ID]=10 AND R[383:Skip Scan-ConvPk]<>0),JMP LBL[210] ;
  12:  IF (R[100:*Tote-Sts ID]=11 AND R[384:Skip Scan-RackPk]<>0),JMP LBL[210] ;
  13:  IF ((R[100:*Tote-Sts ID]=60) AND R[385:Skip Scan-RjctPL]<>0),JMP LBL[210] ;
  14:  !**No Scan Skip ;
  15:  R[38:*Tote-PreScanSts]=R[100:*Tote-Sts ID]    ;
  16:  JMP LBL[300] ;
  17:   ;
  18:  !**Skip Scan ;
  19:  LBL[210] ;
  20:  R[100:*Tote-Sts ID]=25    ;
  21:  JMP LBL[700] ;
  22:   ;
  23:   ;
  24:  !*******Set/Chk Scan Vars******** ;
  25:  LBL[300] ;
  26:  IF (R[36:ScanDn-WaitTm]<.5),R[36:ScanDn-WaitTm]=(.5) ;
  27:  IF (R[36:ScanDn-WaitTm]>5),R[36:ScanDn-WaitTm]=(3) ;
  28:  !Set TIMEOUT (WaitTm x 100) ;
  29:  R[37:*WaitTm x100]=R[36:ScanDn-WaitTm]*100    ;
  30:  JMP LBL[400] ;
  31:   ;
  32:   ;
  33:  !***********FUTURE USE*********** ;
  34:  LBL[400] ;
  35:  JMP LBL[900] ;
  36:   ;
  37:   ;
  38:  !***SCAN NOT RDY***************** ;
  39:  LBL[700] ;
  40:  F[35:OFF:BC Scan-Set]=(OFF) ;
  41:  JMP LBL[999] ;
  42:   ;
  43:  !***SCAN RDY********************* ;
  44:  LBL[900] ;
  45:  F[35:OFF:BC Scan-Set]=(ON) ;
  46:  JMP LBL[999] ;
  47:   ;
  48:   ;
  49:  LBL[999] ;
/POS
/END
