/PROG  _SET_CONV_PK
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "";
PROG_SIZE	= 1305;
CREATE		= DATE 26-07-07  TIME 14:46:48;
MODIFIED	= DATE 26-07-08  TIME 09:22:38;
FILE_NAME	= _SET_RAC;
VERSION		= 0;
LINE_COUNT	= 63;
MEMORY_SIZE	= 1685;
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
   1:  !*******SET CONV PICK POS******** ;
   2:  LBL[100] ;
   3:  F[30:OFF:Conv PKPL Set]=(OFF) ;
   4:  R[30:*ConvPKPL-ID]=0    ;
   5:   ;
   6:   ;
   7:  !*********Chk Pick Pos*********** ;
   8:  LBL[200] ;
   9:  IF R[31:*Prev-ConvPK]=1,JMP LBL[220] ;
  10:  JMP LBL[210] ;
  11:   ;
  12:  !**Chk Infeed1 Rdy ;
  13:  LBL[210] ;
  14:  IF (!DI[17:OFF:Infd Pk Rdy]),JMP LBL[250] ;
  15:  IF (!DI[71:OFF:Infd1 Pres]),JMP LBL[250] ;
  16:  JMP LBL[310] ;
  17:   ;
  18:  !**Chk Recon/Infeed2 Rdy ;
  19:  LBL[220] ;
  20:  IF (!DI[18:OFF:Recon Pk Rdy]),JMP LBL[250] ;
  21:  IF (!DI[72:OFF:Recon-In Pres]),JMP LBL[250] ;
  22:  JMP LBL[320] ;
  23:   ;
  24:  !**Chk any Infeed Rdy ;
  25:  LBL[250] ;
  26:  IF (DI[17:OFF:Infd Pk Rdy] AND DI[71:OFF:Infd1 Pres]),JMP LBL[310] ;
  27:  IF (DI[18:OFF:Recon Pk Rdy] AND DI[72:OFF:Recon-In Pres]),JMP LBL[320] ;
  28:  JMP LBL[700] ;
  29:   ;
  30:   ;
  31:  !***Set Conv Positions*********** ;
  32:  !***Infeed-1*** ;
  33:  LBL[310] ;
  34:  R[30:*ConvPKPL-ID]=1    ;
  35:  PR[30:*Conv PKPL]=PR[111:Orig-Infd1]    ;
  36:  PR[31:*Conv Appr]=PR[116:Appr-InfdOutfd-1]    ;
  37:  JMP LBL[400] ;
  38:   ;
  39:  !***Recon/Infeed-2*** ;
  40:  LBL[320] ;
  41:  R[30:*ConvPKPL-ID]=2    ;
  42:  PR[30:*Conv PKPL]=PR[112:Orig-Infd2/Recon]    ;
  43:  PR[31:*Conv Appr]=PR[117:Appr-ReconConvs]    ;
  44:  JMP LBL[400] ;
  45:   ;
  46:   ;
  47:  !***********FUTURE USE*********** ;
  48:  LBL[400] ;
  49:  JMP LBL[900] ;
  50:   ;
  51:   ;
  52:  !***CONV PK NOT RDY************** ;
  53:  LBL[700] ;
  54:  F[30:OFF:Conv PKPL Set]=(OFF) ;
  55:  JMP LBL[999] ;
  56:   ;
  57:  !***CONV PK RDY****************** ;
  58:  LBL[900] ;
  59:  F[30:OFF:Conv PKPL Set]=(ON) ;
  60:  JMP LBL[999] ;
  61:   ;
  62:   ;
  63:  LBL[999] ;
/POS
/END
