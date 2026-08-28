/PROG  _SCAN_TOTE
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Scan Tote BC";
PROG_SIZE	= 1905;
CREATE		= DATE 26-07-10  TIME 09:28:10;
MODIFIED	= DATE 26-07-24  TIME 02:35:32;
FILE_NAME	= _PK_CONV;
VERSION		= 0;
LINE_COUNT	= 96;
MEMORY_SIZE	= 2433;
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
   1:  !*******SCAN TOTE BARCODE******** ;
   2:  LBL[100] ;
   3:  IF (!F[1:ON :Part in Grip]),JMP LBL[999] ;
   4:  R[34:*ScanDn Tries]=0    ;
   5:  R[35:*Scan Tries]=0    ;
   6:   ;
   7:  !***Setup BC Scan**************** ;
   8:  LBL[110] ;
   9:  F[35:OFF:BC Scan-Set]=(OFF) ;
  10:  CALL _SET_SCAN    ;
  11:  IF (F[35:OFF:BC Scan-Set]),JMP LBL[150] ;
  12:  JMP LBL[999] ;
  13:   ;
  14:  !***Appr Scan (Recon Convs)*** ;
  15:  LBL[150] ;
  16:  IF (DO[202:OFF:At Recon Appr]),JMP LBL[200] ;
  17:  IF (DO[203:OFF:At Scan Pos]),JMP LBL[210] ;
  18:  CALL _APPR_CONVS(5) ;
  19:  IF (F[700:OFF:Appr Error]),JMP LBL[700] ;
  20:  JMP LBL[150] ;
  21:   ;
  22:   ;
  23:  !***Move to Scan Pos************* ;
  24:  LBL[200] ;
  25:  UFRAME_NUM=0 ;
  26:  UTOOL_NUM=1 ;
  27:J PR[117:Appr-ReconConvs] R[104:ToteSpd-J]% CNT50    ;
  28:   ;
  29:  !**Final Move to Scan Pos ;
  30:  LBL[210] ;
  31:  UFRAME_NUM=0 ;
  32:  UTOOL_NUM=1 ;
  33:L PR[35:Scan Pos] R[103:ToteSpd-L]mm/sec FINE    ;
  34:  WAIT (DO[203:OFF:At Scan Pos])    ;
  35:  R[34:*ScanDn Tries]=0    ;
  36:  JMP LBL[300] ;
  37:   ;
  38:   ;
  39:  !***First Scan******************* ;
  40:  LBL[300] ;
  41:  DO[26:OFF:Scan Trigger]=OFF ;
  42:  WAIT    .25(sec) ;
  43:  WAIT (!DI[26:OFF:Scan Pass] AND !DI[27:OFF:Scan Fail])    ;
  44:   ;
  45:  !**Trigger Scan ;
  46:  CALL _SET_WAIT(R[37:*WaitTm x100]) ;
  47:  DO[26:OFF:Scan Trigger]=ON ;
  48:  !Wait for Pass/Fail ;
  49:  //WAIT (DI[26:OFF:Scan Pass] OR DI[27:OFF:Scan Fail]) TIMEOUT,LBL[307] ;
  50:  WAIT (DI[26:OFF:Scan Pass] OR DI[27:OFF:Scan Fail])    ;
  51:  !**Scan Done, Chk Pass/Fail ;
  52:  IF (DI[26:OFF:Scan Pass]),JMP LBL[310] ;
  53:  IF (DI[27:OFF:Scan Fail]),JMP LBL[320] ;
  54:  JMP LBL[307] ;
  55:   ;
  56:  !**Scan Not Done ;
  57:  LBL[307] ;
  58:  R[34:*ScanDn Tries]=R[34:*ScanDn Tries]+1    ;
  59:  IF (R[34:*ScanDn Tries]<2),JMP LBL[300] ;
  60:  !Too Many Done Tries ;
  61:  DO[26:OFF:Scan Trigger]=OFF ;
  62:  DO[58:OFF:Scan Err]=ON ;
  63:  PAUSE ;
  64:  DO[58:OFF:Scan Err]=OFF ;
  65:  JMP LBL[100] ;
  66:   ;
  67:  !***Scan Passed*** ;
  68:  LBL[310] ;
  69:  R[100:*Tote-Sts ID]=20    ;
  70:  JMP LBL[500] ;
  71:   ;
  72:  !***Scan Failed*** ;
  73:  LBL[320] ;
  74:  !TEMP-dont retry, just reject ;
  75:  R[100:*Tote-Sts ID]=70    ;
  76:  JMP LBL[500] ;
  77:   ;
  78:   ;
  79:  !***Retreat Scanner************** ;
  80:  LBL[500] ;
  81:  DO[26:OFF:Scan Trigger]=OFF ;
  82:L PR[117:Appr-ReconConvs] R[103:ToteSpd-L]mm/sec CNT100    ;
  83:  WAIT (DO[202:OFF:At Recon Appr])    ;
  84:  JMP LBL[600] ;
  85:   ;
  86:   ;
  87:  !***Scan Done******************** ;
  88:  LBL[600] ;
  89:  F[35:OFF:BC Scan-Set]=(OFF) ;
  90:  R[34:*ScanDn Tries]=0    ;
  91:  R[35:*Scan Tries]=0    ;
  92:  R[38:*Tote-PreScanSts]=0    ;
  93:  JMP LBL[999] ;
  94:   ;
  95:   ;
  96:  LBL[999] ;
/POS
/END
