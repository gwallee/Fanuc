/PROG  PICK
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Pick part from infeed conveyor";
PROG_SIZE	= 980;
CREATE		= DATE 26-02-11  TIME 09:20:41;
MODIFIED	= DATE 26-07-30  TIME 11:41:19;
LINE_COUNT	= 18;
MEMORY_SIZE	= 2100;
PROTECT		= READ_WRITE;
DEFAULT_GROUP	= 1,*,*,*,*;
/MN
   1:  !Pick from infeed nest ;
   2:  UFRAME_NUM=1 ;
   3:  UTOOL_NUM=1 ;
   4:  CALL GRIPPER(1) ;
   5:J P[1:pick approach] 100% CNT50 ;
   6:L P[2:pick] 250mm/sec FINE ;
   7:  WAIT   .20(sec) ;
   8:  CALL GRIPPER(2) ;
   9:  WAIT DI[103:part in gripper]=ON TIMEOUT,LBL[900] ;
  10:  PAYLOAD[2:part in gripper] ;
  11:L P[1:pick approach] 500mm/sec CNT100 ;
  12:  DO[110:infeed release]=PULSE,0.5sec ;
  13:  END ;
  14:  LBL[900:grip fault] ;
  15:  CALL GRIPPER(1) ;
  16:  UALM[2] ;
  17:  ABORT ;
  18:  !end ;
/POS
P[1:"pick approach"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =  1105.500  mm,	Y =  -312.250  mm,	Z =   410.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =   -45.000 deg
};
P[2:"pick"]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =  1105.500  mm,	Y =  -312.250  mm,	Z =   285.300  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =   -45.000 deg
};
/END
