/PROG  _BGL_STANDARD
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "BGLogic Standard";
PROG_SIZE	= 1659;
CREATE		= DATE 19-09-27  TIME 22:19:32;
MODIFIED	= DATE 26-07-13  TIME 11:10:04;
FILE_NAME	= _BGLOGIC;
VERSION		= 0;
LINE_COUNT	= 63;
MEMORY_SIZE	= 1971;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= *,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
LOCAL_REGISTERS	= 0,0,0;
/APPL

AUTO_SINGULARITY_HEADER;
  ENABLE_SINGULARITY_AVOIDANCE   : FALSE;
/MN
   1:  !***STANDARD BACKGROUND LOGIC**** ;
   2:  !***Chk all BGLogic progs ON*** ;
   3:  IF (DO[63:OFF:BGLogic Off] OR F[1010:OFF:BGL Chk-Running]) THEN ;
   4:  F[1010:OFF:BGL Chk-Running]=(ON) ;
   5:  !Chk BGL-Custom Running ;
   6:  IF (!F[1017:OFF:BGL-Custom ON]) THEN ;
   7:  F[1011:OFF:BGL-Custom Chk]=(ON) ;
   8:  ENDIF ;
   9:  IF (F[1011:OFF:BGL-Custom Chk] AND F[1014:OFF:BGL-Custom Ack]) THEN ;
  10:  F[1017:OFF:BGL-Custom ON]=(ON) ;
  11:  F[1011:OFF:BGL-Custom Chk]=(OFF) ;
  12:  F[1014:OFF:BGL-Custom Ack]=(OFF) ;
  13:  ENDIF ;
  14:  !Chk BGL-TaskLog Running ;
  15:  IF (!F[1018:OFF:BGL-TaskLog ON]) THEN ;
  16:  F[1012:OFF:BGL-TaskLog Chk]=(ON) ;
  17:  ENDIF ;
  18:  IF (F[1012:OFF:BGL-TaskLog Chk] AND F[1015:OFF:BGL-TaskLog Ack]) THEN ;
  19:  F[1018:OFF:BGL-TaskLog ON]=(ON) ;
  20:  F[1012:OFF:BGL-TaskLog Chk]=(OFF) ;
  21:  F[1015:OFF:BGL-TaskLog Ack]=(OFF) ;
  22:  ENDIF ;
  23:  !Turn OFF Alarm if all BGL ON ;
  24:  IF (F[1017:OFF:BGL-Custom ON] AND F[1018:OFF:BGL-TaskLog ON]) THEN ;
  25:  DO[63:OFF:BGLogic Off]=OFF ;
  26:  F[1010:OFF:BGL Chk-Running]=(OFF) ;
  27:  F[1017:OFF:BGL-Custom ON]=(OFF) ;
  28:  F[1018:OFF:BGL-TaskLog ON]=(OFF) ;
  29:  ENDIF ;
  30:  ELSE ;
  31:  !Not Checking BGL-Init Flags ;
  32:  F[1010:OFF:BGL Chk-Running]=(OFF) ;
  33:  F[1011:OFF:BGL-Custom Chk]=(OFF) ;
  34:  F[1012:OFF:BGL-TaskLog Chk]=(OFF) ;
  35:  F[1014:OFF:BGL-Custom Ack]=(OFF) ;
  36:  F[1015:OFF:BGL-TaskLog Ack]=(OFF) ;
  37:  F[1017:OFF:BGL-Custom ON]=(OFF) ;
  38:  F[1018:OFF:BGL-TaskLog ON]=(OFF) ;
  39:  ENDIF ;
  40:   ;
  41:  !***Chk PwrCycle, WORLD coord*** ;
  42:  IF (!F[1024:ON :Pwr Cycled ons]),$JCR_GRP[1].$JOG_COORD=(2) ;
  43:  IF (!F[1024:ON :Pwr Cycled ons]),DO[112:ON :Power Cycled]=(ON) ;
  44:  F[1024:ON :Pwr Cycled ons]=(ON) ;
  45:   ;
  46:  !***Chk Robot Jogged*** ;
  47:  IF ($MOR_GRP[1].$JOGGED=1 AND !F[1022:OFF:Jogged ons]) THEN ;
  48:  DO[60:OFF:Jogged]=($MOR_GRP[1].$JOGGED) ;
  49:  ENDIF ;
  50:  F[1022:OFF:Jogged ons]=($MOR_GRP[1].$JOGGED) ;
  51:  !Unlatch Jogged ;
  52:  IF ($MOR_GRP[1].$JOGGED=0),DO[60:OFF:Jogged]=(OFF) ;
  53:   ;
  54:  !***Turn off TP Start Req*** ;
  55:  IF ((UO[10:OFF:Busy] AND !UO[4:OFF:Prg paused]) OR DO[64:OFF:TP Prompt]),DO[113:OFF:Start-TP]=(OFF) ;
  56:   ;
  57:  !***Chk RTE or Pause ON*** ;
  58:  F[101:OFF:Sys Chks]=(DI[3:OFF:Pause] OR DI[4:OFF:RTE]) ;
  59:   ;
  60:  !***Chk if Robot in motion*** ;
  61:  DO[111:OFF:ACK 1]=($MOR_GRP[1].$ROB_MOVE) ;
  62:   ;
  63:  !***END BGLOGIC STANDARD********* ;
/POS
/END
