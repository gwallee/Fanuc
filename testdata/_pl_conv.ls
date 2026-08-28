/PROG  _PL_CONV
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "PL on OutfdConvs";
PROG_SIZE	= 1899;
CREATE		= DATE 26-07-08  TIME 14:12:30;
MODIFIED	= DATE 26-08-24  TIME 15:09:34;
FILE_NAME	= _PK_CONV;
VERSION		= 0;
LINE_COUNT	= 92;
MEMORY_SIZE	= 2323;
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
   1:  !*******PLACE TOTE IN CONV******* ;
   2:  LBL[100] ;
   3:  IF (!F[1:ON :Part in Grip]),JMP LBL[999] ;
   4:   ;
   5:   ;
   6:  !***Set Conv PL Pos************** ;
   7:  LBL[150] ;
   8:  F[30:OFF:Conv PKPL Set]=(OFF) ;
   9:  CALL _SET_CONV_PL    ;
  10:  IF (F[30:OFF:Conv PKPL Set]),JMP LBL[200] ;
  11:  JMP LBL[999] ;
  12:   ;
  13:   ;
  14:  !***Appr Conveyor**************** ;
  15:  LBL[200] ;
  16:  CALL _APPR_CONVS(R[30:*ConvPKPL-ID]) ;
  17:  IF (F[700:OFF:Appr Error]),JMP LBL[700] ;
  18:  JMP LBL[300] ;
  19:   ;
  20:   ;
  21:  !***Move to Conv***************** ;
  22:  LBL[300] ;
  23:  UFRAME_NUM=3 ;
  24:  UTOOL_NUM=1 ;
  25:   ;
  26:J PR[31:*Conv Appr] R[104:ToteSpd-J]% CNT50    ;
  27:   ;
  28:  CALL _SET_OFFS((-700),0,30,61) ;
  29:L PR[30:*Conv PKPL] R[103:ToteSpd-L]mm/sec CNT50 Tool_Offset    ;
  30:  CALL _SET_OFFS((-550),0,30,61) ;
  31:L PR[30:*Conv PKPL] R[103:ToteSpd-L]mm/sec CNT100 Tool_Offset AP_LD100    ;
  32:  CALL _SET_OFFS(0,0,15,61) ;
  33:L PR[30:*Conv PKPL] R[107:Rtrt Spd]mm/sec CNT25 Tool_Offset    ;
  34:   ;
  35:  !**Move to PL Pos ;
  36:  LBL[350] ;
  37:  CALL _SET_OFFS(0,0,1,61) ;
  38:L PR[30:*Conv PKPL] R[106:PL Spd]mm/sec FINE Tool_Offset    ;
  39:  JMP LBL[400] ;
  40:   ;
  41:   ;
  42:  !***Drop Tote******************** ;
  43:  LBL[400] ;
  44:  IF R[30:*ConvPKPL-ID]=3,JMP LBL[401] ;
  45:  JMP LBL[402] ;
  46:  !**Outfd1 PL hs ;
  47:  LBL[401] ;
  48:  DO[19:OFF:Outfd Placed]=ON ;
  49:  JMP LBL[410] ;
  50:  !**Recon PL hs ;
  51:  LBL[402] ;
  52:  DO[20:OFF:Recon Placed]=ON ;
  53:  JMP LBL[420] ;
  54:   ;
  55:  !***Open Grip*** ;
  56:  LBL[410] ;
  57:  CALL _GRIP_PL    ;
  58:  R[5:*Grp-ToteID]=0    ;
  59:  R[100:*Tote-Sts ID]=0    ;
  60:  JMP LBL[500] ;
  61:   ;
  62:   ;
  63:  !***Retreat Conv***************** ;
  64:  LBL[500] ;
  65:  CALL _SET_OFFS(0,0,(-15),61) ;
  66:L PR[30:*Conv PKPL] R[106:PL Spd]mm/sec CNT10 Tool_Offset    ;
  67:  CALL _SET_OFFS((-200),0,(-15),61) ;
  68:L PR[30:*Conv PKPL] R[107:Rtrt Spd]mm/sec CNT100 Tool_Offset    ;
  69:  CALL _SET_OFFS((-500),0,(-15),61) ;
  70:L PR[30:*Conv PKPL] R[101:EmptySpd-L]mm/sec CNT100 Tool_Offset    ;
  71:   ;
  72:  !**Finish hs ;
  73:  WAIT (!DI[19:OFF:Outfd PL Rdy] AND !DI[20:OFF:Recon PL Rdy])    ;
  74:  DO[19:OFF:Outfd Placed]=OFF ;
  75:  DO[20:OFF:Recon Placed]=OFF ;
  76:   ;
  77:  !***Go to Appr Pos*** ;
  78:  LBL[550] ;
  79:L PR[31:*Conv Appr] R[101:EmptySpd-L]mm/sec FINE    ;
  80:  WAIT (DO[201:OFF:At Conv1/3 Appr] OR DO[202:OFF:At Recon Appr])    ;
  81:  JMP LBL[600] ;
  82:   ;
  83:   ;
  84:  !***Place Done******************* ;
  85:  LBL[600] ;
  86:  F[30:OFF:Conv PKPL Set]=(OFF) ;
  87:  R[32:*Prev-ConvPL]=R[30:*ConvPKPL-ID]    ;
  88:  R[30:*ConvPKPL-ID]=0    ;
  89:  JMP LBL[999] ;
  90:   ;
  91:   ;
  92:  LBL[999] ;
/POS
/END
