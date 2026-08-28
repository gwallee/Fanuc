/PROG  PALLET
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Full pallet exchange handshake";
PROG_SIZE	= 760;
CREATE		= DATE 26-02-11  TIME 09:48:55;
MODIFIED	= DATE 26-06-21  TIME 08:15:03;
LINE_COUNT	= 13;
MEMORY_SIZE	= 1856;
PROTECT		= READ_WRITE;
DEFAULT_GROUP	= *,*,*,*,*;
/MN
   1:  !Pallet full: request exchange ;
   2:  DO[120:pallet full]=ON ;
   3:  MESSAGE[PALLET FULL - EXCHANGING] ;
   4:  WAIT DI[121:pallet removed]=ON ;
   5:  DO[120:pallet full]=OFF ;
   6:  WAIT DI[122:new pallet ready]=ON ;
   7:  R[10:pallet slot]=1 ;
   8:  R[4:pallet count]=R[4:pallet count]+1 ;
   9:  GO[1:pallets done]=R[4:pallet count] ;
  10:  END ;
  11:  !no fault path: operator ;
  12:  !handles exchange manually ;
  13:  !end ;
/END
