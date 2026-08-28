/PROG  GRIPPER
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "AR[1]=1 open, 2 close";
PROG_SIZE	= 620;
CREATE		= DATE 26-02-11  TIME 09:40:12;
MODIFIED	= DATE 26-05-14  TIME 10:22:31;
LINE_COUNT	= 14;
MEMORY_SIZE	= 1720;
PROTECT		= READ_WRITE;
DEFAULT_GROUP	= *,*,*,*,*;
/MN
   1:  !AR[1]: 1=open 2=close ;
   2:  IF AR[1]=2,JMP LBL[20] ;
   3:  LBL[10:open] ;
   4:  RO[1:gripper close]=OFF ;
   5:  RO[2:gripper open]=ON ;
   6:  WAIT RI[1:gripper opened]=ON ;
   7:  JMP LBL[30] ;
   8:  LBL[20:close] ;
   9:  RO[2:gripper open]=OFF ;
  10:  RO[1:gripper close]=ON ;
  11:  WAIT RI[2:gripper closed]=ON ;
  12:  LBL[30:done] ;
  13:  END ;
  14:  !end ;
/END
