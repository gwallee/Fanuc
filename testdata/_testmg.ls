/PROG  _TESTMG
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "";
PROG_SIZE	= 1194;
CREATE		= DATE 26-06-12  TIME 05:43:56;
MODIFIED	= DATE 26-06-25  TIME 01:39:30;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 26;
MEMORY_SIZE	= 1626;
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
   1:  LBL[1] ;
   2:   ;
   3:J P[9] 100% FINE    ;
   4:   ;
   5:   ;
   6:  JMP LBL[1] ;
   7:   ;
   8:  WAIT    .50(sec) ;
   9:L P[4] 1500mm/sec FINE    ;
  10:L P[5] 1500mm/sec FINE    ;
  11:  CALL _CLAMP_DOWN    ;
  12:  WAIT    .50(sec) ;
  13:  CALL _CLAMP_IN    ;
  14:  WAIT    .50(sec) ;
  15:L P[6] 500mm/sec FINE    ;
  16:L P[8] 1500mm/sec FINE    ;
  17:   ;
  18:   ;
  19:   ;
  20:L P[7] 1500mm/sec FINE    ;
  21:L P[1] 1500mm/sec FINE    ;
  22:  CALL _CLAMP_OUT    ;
  23:  WAIT    .50(sec) ;
  24:  CALL _CLAMP_UP    ;
  25:L P[2] 1500mm/sec FINE    ;
  26:L P[3] 500mm/sec FINE    ;
/POS
P[1]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'F U T, 0, 0, 0',
	X = -1866.838  mm,	Y =   790.415  mm,	Z =  -560.962  mm,
	W =      .083 deg,	P =      .323 deg,	R =   179.223 deg
};
P[2:""]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'F U T, 0, 0, 0',
	X = -1874.902  mm,	Y =   790.482  mm,	Z =  -589.888  mm,
	W =      .083 deg,	P =      .323 deg,	R =   179.223 deg
};
P[3]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'F U T, 0, 0, 0',
	X = -1439.448  mm,	Y =   784.574  mm,	Z =  -587.435  mm,
	W =      .083 deg,	P =      .323 deg,	R =   179.223 deg
};
P[4]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'F U T, 0, 0, 0',
	X = -1883.473  mm,	Y =   790.598  mm,	Z =  -589.936  mm,
	W =      .083 deg,	P =      .323 deg,	R =   179.223 deg
};
P[5]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'F U T, 0, 0, 0',
	X = -1883.553  mm,	Y =   790.620  mm,	Z =  -575.651  mm,
	W =      .083 deg,	P =      .323 deg,	R =   179.223 deg
};
P[6]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'F U T, 0, 0, 0',
	X = -1887.654  mm,	Y =   790.721  mm,	Z =  -544.959  mm,
	W =      .083 deg,	P =      .323 deg,	R =   179.223 deg
};
P[7]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'F U T, 0, 0, 0',
	X = -1238.447  mm,	Y =   781.915  mm,	Z =  -541.336  mm,
	W =      .086 deg,	P =      .327 deg,	R =   179.221 deg
};
P[8]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'F U T, 0, 0, 0',
	X = -1238.469  mm,	Y =   781.917  mm,	Z =  -541.297  mm,
	W =      .083 deg,	P =      .323 deg,	R =   179.223 deg
};
P[9]{
   GP1:
	UF : 1, UT : 1,		CONFIG : 'F U T, 0, 0, 0',
	X =     0.000  mm,	Y =  -875.191  mm,	Z =     0.000  mm,
	W =     -.000 deg,	P =      .000 deg,	R =    90.000 deg
};
/END
