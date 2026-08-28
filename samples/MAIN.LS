/PROG  MAIN
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Cell main - pick & place cycle";
PROG_SIZE	= 1420;
CREATE		= DATE 26-02-11  TIME 09:14:02;
MODIFIED	= DATE 26-08-19  TIME 14:02:55;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 34;
MEMORY_SIZE	= 2688;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/MN
   1:  !------------------------------ ;
   2:  ! MAIN cycle: pick from infeed  ;
   3:  ! place onto pallet, count parts ;
   4:  !------------------------------ ;
   5:  UFRAME_NUM=1 ;
   6:  UTOOL_NUM=1 ;
   7:  PAYLOAD[1:empty gripper] ;
   8:  OVERRIDE=100% ;
   9:  R[1:part count]=0 ;
  10:  R[2:target count]=GI[1:batch size] ;
  11:  R[10:pallet slot]=1 ;
  12:  TIMER[1]=RESET ;
  13:  TIMER[1]=START ;
  14:  CALL GRIPPER(1) ;
  15:J P[1:home] 100% FINE ;
  16:  DO[104:cell running]=ON ;
  17:  LBL[10:cycle top] ;
  18:  WAIT DI[101:part present]=ON TIMEOUT,LBL[900] ;
  19:  CALL PICK ;
  20:  CALL PLACE ;
  21:  R[1:part count]=R[1:part count]+1 ;
  22:  R[10:pallet slot]=R[10:pallet slot]+1 ;
  23:  IF R[10:pallet slot]>12,CALL PALLET ;
  24:  IF R[1:part count]<R[2:target count],JMP LBL[10] ;
  25:  TIMER[1]=STOP ;
  26:  R[3:cycle time]=TIMER[1] ;
  27:J P[1:home] 100% FINE ;
  28:  DO[104:cell running]=OFF ;
  29:  DO[105:batch done]=PULSE,1.0sec ;
  30:  MESSAGE[BATCH COMPLETE] ;
  31:  END ;
  32:  LBL[900:no part fault] ;
  33:  UALM[1] ;
  34:  ABORT ;
/POS
P[1:"home"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   785.000  mm,	Y =     0.000  mm,	Z =   940.000  mm,
	W =   179.900 deg,	P =    -0.100 deg,	R =     0.000 deg
};
/END
