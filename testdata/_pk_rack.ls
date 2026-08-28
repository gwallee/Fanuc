/PROG  _PK_RACK
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Pick Buffer Rack";
PROG_SIZE	= 1875;
CREATE		= DATE 26-06-29  TIME 15:37:58;
MODIFIED	= DATE 26-07-14  TIME 15:15:06;
FILE_NAME	= _PL_RACK;
VERSION		= 0;
LINE_COUNT	= 88;
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
   1:  !******PICK TOTE FROM RACK******* ;
   2:  LBL[100] ;
   3:  IF (F[1:ON :Part in Grip]),JMP LBL[999] ;
   4:   ;
   5:   ;
   6:  !***Set Rack Pk Pos************** ;
   7:  LBL[150] ;
   8:  F[20:OFF:Rack PKPL-Set]=(OFF) ;
   9:  CALL _SET_RACK_PK    ;
  10:  IF (F[20:OFF:Rack PKPL-Set]),JMP LBL[200] ;
  11:  JMP LBL[999] ;
  12:   ;
  13:   ;
  14:  !***Appr Rack******************** ;
  15:  LBL[200] ;
  16:  CALL _APPR_RACKS(0) ;
  17:  IF (F[700:OFF:Appr Error]),JMP LBL[700] ;
  18:   ;
  19:  IF ((R[25:*Slot-Colmn]=1 OR R[25:*Slot-Colmn]=2) AND DO[211:ON :At L-RacksApr]),JMP LBL[300] ;
  20:  IF ((R[25:*Slot-Colmn]=3 OR R[25:*Slot-Colmn]=4) AND DO[212:OFF:At R-RacksApr]),JMP LBL[300] ;
  21:  JMP LBL[200] ;
  22:   ;
  23:   ;
  24:  !***Move into Rack*************** ;
  25:  LBL[300] ;
  26:  UFRAME_NUM=R[20:*RackNum] ;
  27:  UTOOL_NUM=1 ;
  28:   ;
  29:J PR[21:*Rack Appr] R[102:EmptySpd-J]% CNT50    ;
  30:  CALL _SET_OFFS(0,(-475),(-15),60) ;
  31:L PR[20:*Rack PKPL] R[101:EmptySpd-L]mm/sec CNT50 Offset    ;
  32:  CALL _GRIP_OPEN    ;
  33:   ;
  34:  CALL _SET_OFFS(0,(-250),(-15),60) ;
  35:L PR[20:*Rack PKPL] R[101:EmptySpd-L]mm/sec CNT50 Offset    ;
  36:  CALL _SET_OFFS(0,0,(-15),60) ;
  37:L PR[20:*Rack PKPL] R[110:RackPLSpd]mm/sec FINE Offset    ;
  38:   ;
  39:  !**Move to PK Pos ;
  40:  LBL[350] ;
  41:  CALL _SET_OFFS(0,0,3,60) ;
  42:L PR[20:*Rack PKPL] R[105:Pk Spd]mm/sec FINE Offset    ;
  43:  JMP LBL[400] ;
  44:   ;
  45:   ;
  46:  !***Grip Tote******************** ;
  47:  LBL[400] ;
  48:  CALL _GRIP_PK    ;
  49:  R[5:*Grp-ToteID]=R[21:*SlotNum]    ;
  50:  R[100:*Tote-Sts ID]=11    ;
  51:  R[13:*PrvPk-Conv/Rack]=2    ;
  52:   ;
  53:  !**Update Rack Slot Status ;
  54:  R[199:*RackSts-Reg]=R[21:*SlotNum]+200    ;
  55:  R[R[199]]=0    ;
  56:  JMP LBL[500] ;
  57:   ;
  58:   ;
  59:  !***Retreat Rack***************** ;
  60:  LBL[500] ;
  61:  CALL _SET_OFFS(0,0,10,60) ;
  62:L PR[20:*Rack PKPL] R[105:Pk Spd]mm/sec CNT25 Offset    ;
  63:  CALL _SET_OFFS(0,(-675),10,60) ;
  64:L PR[20:*Rack PKPL] R[111:RackPkSpd]mm/sec CNT50 Offset    ;
  65:   ;
  66:  !**Rack Pk hs ;
  67:  DO[21:OFF:Rack Picked]=ON ;
  68:  WAIT (!DI[21:OFF:RackPK Rdy])    ;
  69:  DO[21:OFF:Rack Picked]=OFF ;
  70:   ;
  71:  !**Return to Rack Appr ;
  72:L PR[21:*Rack Appr] R[103:ToteSpd-L]mm/sec CNT75    ;
  73:  WAIT (DO[211:ON :At L-RacksApr] OR DO[212:OFF:At R-RacksApr])    ;
  74:  JMP LBL[600] ;
  75:   ;
  76:   ;
  77:  !***Pick Done******************** ;
  78:  LBL[600] ;
  79:  R[14:*PrevPk-Rack]=R[20:*RackNum]    ;
  80:  R[15:*PrevPk-Colmn]=R[25:*Slot-Colmn]    ;
  81:  R[16:*PrevPk-Row]=R[26:*Slot-Row]    ;
  82:  R[20:*RackNum]=0    ;
  83:  R[25:*Slot-Colmn]=0    ;
  84:  R[26:*Slot-Row]=0    ;
  85:  JMP LBL[999] ;
  86:   ;
  87:   ;
  88:  LBL[999] ;
/POS
/END
