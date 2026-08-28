/PROG  _SET_CONV_PL
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "";
PROG_SIZE	= 1113;
CREATE		= DATE 26-07-08  TIME 15:03:14;
MODIFIED	= DATE 26-07-08  TIME 15:41:26;
FILE_NAME	= _SET_CON;
VERSION		= 0;
LINE_COUNT	= 52;
MEMORY_SIZE	= 1537;
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
   1:  !*******SET CONV PLACE POS******* ;
   2:  LBL[100] ;
   3:  F[30:OFF:Conv PKPL Set]=(OFF) ;
   4:  R[30:*ConvPKPL-ID]=0    ;
   5:   ;
   6:   ;
   7:  !***Chk Robot EOAT*************** ;
   8:  LBL[150] ;
   9:  IF (!F[1:ON :Part in Grip]),JMP LBL[700] ;
  10:   ;
  11:   ;
  12:  !***Chk Place Pos**************** ;
  13:  LBL[200] ;
  14:  IF (DI[19:OFF:Outfd PL Rdy] AND DI[20:OFF:Recon PL Rdy]),JMP LBL[700] ;
  15:  IF (DI[19:OFF:Outfd PL Rdy]),JMP LBL[310] ;
  16:  IF (DI[20:OFF:Recon PL Rdy]),JMP LBL[320] ;
  17:  JMP LBL[700] ;
  18:   ;
  19:   ;
  20:  !***Set Conv Positions*********** ;
  21:  !***Outfeed-1*** ;
  22:  LBL[310] ;
  23:  R[30:*ConvPKPL-ID]=3    ;
  24:  PR[30:*Conv PKPL]=PR[113:Orig-Outfd1]    ;
  25:  PR[31:*Conv Appr]=PR[116:Appr-InfdOutfd-1]    ;
  26:  JMP LBL[400] ;
  27:   ;
  28:  !***Recon/Outfeed-2*** ;
  29:  LBL[320] ;
  30:  R[30:*ConvPKPL-ID]=4    ;
  31:  PR[30:*Conv PKPL]=PR[114:Orig-Outfd/Recon]    ;
  32:  PR[31:*Conv Appr]=PR[117:Appr-ReconConvs]    ;
  33:  JMP LBL[400] ;
  34:   ;
  35:   ;
  36:  !***********FUTURE USE*********** ;
  37:  LBL[400] ;
  38:  JMP LBL[900] ;
  39:   ;
  40:   ;
  41:  !***CONV PL NOT RDY************** ;
  42:  LBL[700] ;
  43:  F[30:OFF:Conv PKPL Set]=(OFF) ;
  44:  JMP LBL[999] ;
  45:   ;
  46:  !***CONV PL RDY****************** ;
  47:  LBL[900] ;
  48:  F[30:OFF:Conv PKPL Set]=(ON) ;
  49:  JMP LBL[999] ;
  50:   ;
  51:   ;
  52:  LBL[999] ;
/POS
/END
