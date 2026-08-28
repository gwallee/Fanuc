/PROG  PLACE
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Place part at computed pallet slot";
PROG_SIZE	= 1104;
CREATE		= DATE 26-02-11  TIME 09:33:07;
MODIFIED	= DATE 26-08-02  TIME 16:09:44;
LINE_COUNT	= 20;
MEMORY_SIZE	= 2304;
PROTECT		= READ_WRITE;
DEFAULT_GROUP	= 1,*,*,*,*;
/MN
   1:  !Place at slot R[10] using PR[20] offset ;
   2:  UFRAME_NUM=2 ;
   3:  UTOOL_NUM=1 ;
   4:  !Compute slot offset: 4 cols x 3 rows, 90mm pitch ;
   5:  R[11:col]=(R[10:pallet slot]-1) MOD 4 ;
   6:  R[12:row]=(R[10:pallet slot]-1) DIV 4 ;
   7:  PR[20:slot offset]=PR[21:zero] ;
   8:  PR[20,1]=R[11:col]*90 ;
   9:  PR[20,2]=R[12:row]*90 ;
  10:J P[1:place approach] 100% CNT50 ;
  11:L P[2:place] 300mm/sec FINE Offset,PR[20:slot offset] ;
  12:  CALL GRIPPER(1) ;
  13:  WAIT   .20(sec) ;
  14:  PAYLOAD[1:empty gripper] ;
  15:L P[1:place approach] 500mm/sec CNT100 Offset,PR[20:slot offset] ;
  16:  END ;
  17:  LBL[900:unused fault] ;
  18:  UALM[3] ;
  19:  ABORT ;
  20:  !end ;
/POS
P[1:"place approach"]{
   GP1:
	UF : 2, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    45.000  mm,	Y =    45.000  mm,	Z =   250.000  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =    90.000 deg
};
P[2:"place"]{
   GP1:
	UF : 2, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    45.000  mm,	Y =    45.000  mm,	Z =    82.500  mm,
	W =   180.000 deg,	P =     0.000 deg,	R =    90.000 deg
};
/END
