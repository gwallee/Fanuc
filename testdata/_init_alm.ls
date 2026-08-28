/PROG  _INIT_ALM
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Init Alarms";
PROG_SIZE	= 509;
CREATE		= DATE 19-01-18  TIME 16:47:02;
MODIFIED	= DATE 26-07-15  TIME 14:54:22;
FILE_NAME	= _INIT_AL;
VERSION		= 0;
LINE_COUNT	= 18;
MEMORY_SIZE	= 809;
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
   1:  !***Ver:P-00, 2022-02-28, DG*** ;
   2:  !ProdSys: Initialize Robot Alarms ;
   3:  DO[49:OFF:Activate Alarm (SR)]=OFF ;
   4:  DO[50:OFF]=OFF ;
   5:  DO[51:OFF:Unknown ToteID]=OFF ;
   6:  DO[52:OFF:Unknown ToteSts]=OFF ;
   7:  DO[53:OFF:Tote Task Err]=OFF ;
   8:  DO[54:OFF:DCS Err]=OFF ;
   9:  DO[55:OFF:Col Detect]=OFF ;
  10:  DO[56:OFF:Hopper Err]=OFF ;
  11:  DO[57:OFF:Inspect Err]=OFF ;
  12:  DO[58:OFF:Scan Err]=OFF ;
  13:  DO[59:OFF:Rjct Not Rdy]=OFF ;
  14:  DO[60:OFF:Jogged]=OFF ;
  15:  DO[61:OFF:IO Simulated]=OFF ;
  16:  DO[62:OFF:Recov Error]=OFF ;
  17:  //DO[63:OFF:BGLogic Off]=ON ;
  18:  DO[64:OFF:TP Prompt]=OFF ;
/POS
/END
