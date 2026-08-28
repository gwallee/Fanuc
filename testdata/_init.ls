/PROG  _INIT
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Initialize Run";
PROG_SIZE	= 868;
CREATE		= DATE 24-05-23  TIME 14:00:42;
MODIFIED	= DATE 26-07-15  TIME 14:54:32;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 41;
MEMORY_SIZE	= 1352;
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
/MN
   1:  !***INITIALIZE SYSTEM FOR RUN*** ;
   2:  LBL[100] ;
   3:  R[1:Task ID]=92    ;
   4:  R[13:*PrvPk-Conv/Rack]=0    ;
   5:   ;
   6:  !***Turn Off Handshakes*** ;
   7:  FOR R[99:*temp]=17 TO 32 ;
   8:  DO[R[99]]=OFF ;
   9:  ENDFOR ;
  10:   ;
  11:  !***Clear Registers/IO*** ;
  12:  R[2:Manual TaskID]=0    ;
  13:  DO[5:OFF:Task Done]=OFF ;
  14:  F[8:OFF:Task Rdy]=(OFF) ;
  15:  F[9:OFF:Simulation]=(OFF) ;
  16:  F[10:OFF:Execute Task]=(OFF) ;
  17:  R[13:*PrvPk-Conv/Rack]=0    ;
  18:  R[31:*Prev-ConvPK]=0    ;
  19:  R[32:*Prev-ConvPL]=0    ;
  20:   ;
  21:  !***Clear Process Flags*** ;
  22:  F[20:OFF:Rack PKPL-Set]=(OFF) ;
  23:  F[30:OFF:Conv PKPL Set]=(OFF) ;
  24:  F[35:OFF:BC Scan-Set]=(OFF) ;
  25:  F[37:OFF:Scan Fail]=(OFF) ;
  26:  F[40:OFF:Hopper-Set]=(OFF) ;
  27:  F[45:OFF:PreInspect-Set]=(OFF) ;
  28:  F[46:OFF:PostInspect-Set]=(OFF) ;
  29:  F[47:OFF:Inspect Fail]=(OFF) ;
  30:  F[70:OFF:Rjct PL-Set]=(OFF) ;
  31:  F[104:OFF:Sys Chks Ran]=(OFF) ;
  32:  F[700:OFF:Appr Error]=(OFF) ;
  33:   ;
  34:  !***Init Gripper*** ;
  35:  CALL _INIT_EOAT    ;
  36:  !***Init Alarms*** ;
  37:  CALL _INIT_ALM    ;
  38:   ;
  39:  !***Chk BGL Running*** ;
  40:  DO[63:OFF:BGLogic Off]=ON ;
  41:  WAIT (!DO[63:OFF:BGLogic Off])    ;
/POS
/END
