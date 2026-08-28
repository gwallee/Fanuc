/PROG  _RECOV_REFPOS
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "";
PROG_SIZE	= 1669;
CREATE		= DATE 24-03-10  TIME 08:57:32;
MODIFIED	= DATE 24-03-10  TIME 09:42:52;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 90;
MEMORY_SIZE	= 2069;
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
   1:  LBL[100] ;
   2:  IF (DO[141: * ]),JMP LBL[410] ;
   3:  IF (DO[142: * ]),JMP LBL[420] ;
   4:  IF (DO[143: * ]),JMP LBL[430] ;
   5:  IF (DO[145: * ]),JMP LBL[440] ;
   6:  IF (DO[153: * ]),JMP LBL[510] ;
   7:  IF (DO[154: * ]),JMP LBL[520] ;
   8:  IF (DO[155: * ]),JMP LBL[530] ;
   9:  IF (DO[157: * ]),JMP LBL[540] ;
  10:  JMP LBL[999] ;
  11:   ;
  12:   ;
  13:  !**********AT CONV APPR********** ;
  14:  !***At Conv: 90, Low, Nrml*** ;
  15:  LBL[410] ;
  16:  UFRAME_NUM=0 ;
  17:  UTOOL_NUM=1 ;
  18:J PR[131:Appr-Rack1-Left] 25% CNT10    ;
  19:J PR[180] 25% CNT100    ;
  20:J PR[5:Trans-Origin] 25% CNT100    ;
  21:  WAIT (DO[37:OFF:At Transit])    ;
  22:  JMP LBL[999] ;
  23:   ;
  24:  !***At Conv: 90, Low, Wound*** ;
  25:  LBL[420] ;
  26:  UFRAME_NUM=0 ;
  27:  UTOOL_NUM=1 ;
  28:J PR[132:Appr-Rack1-Right] 25% CNT10    ;
  29:L PR[135:Appr-Rack3-Left] 750mm/sec CNT100    ;
  30:J PR[5:Trans-Origin] 25% CNT100    ;
  31:  WAIT (DO[37:OFF:At Transit])    ;
  32:  JMP LBL[999] ;
  33:   ;
  34:  !***At Conv: 90, Mid, Nrml*** ;
  35:  LBL[430] ;
  36:  UFRAME_NUM=0 ;
  37:  UTOOL_NUM=1 ;
  38:J PR[133:Appr-Rack2-Left] 25% CNT10    ;
  39:L PR[135:Appr-Rack3-Left] 750mm/sec CNT100    ;
  40:J PR[5:Trans-Origin] 25% CNT100    ;
  41:  WAIT (DO[37:OFF:At Transit])    ;
  42:  JMP LBL[999] ;
  43:   ;
  44:  !***At Conv: 90, High, Nrml*** ;
  45:  LBL[440] ;
  46:  UFRAME_NUM=0 ;
  47:  UTOOL_NUM=1 ;
  48:J PR[135:Appr-Rack3-Left] 25% CNT10    ;
  49:J PR[5:Trans-Origin] 25% CNT100    ;
  50:  WAIT (DO[37:OFF:At Transit])    ;
  51:  JMP LBL[999] ;
  52:   ;
  53:  !***At Conv: -90, Low, Nrml*** ;
  54:  LBL[510] ;
  55:  UFRAME_NUM=0 ;
  56:  UTOOL_NUM=1 ;
  57:J PR[143:Hop2 L-Rack-1] 25% CNT10    ;
  58:J PR[5:Trans-Origin] 25% CNT100    ;
  59:  WAIT (DO[37:OFF:At Transit])    ;
  60:  JMP LBL[999] ;
  61:   ;
  62:  !***At Conv: -90, Low, Wound*** ;
  63:  LBL[520] ;
  64:  UFRAME_NUM=0 ;
  65:  UTOOL_NUM=1 ;
  66:J PR[144:Hop2 L-Rack-2] 25% CNT10    ;
  67:J PR[5:Trans-Origin] 25% CNT100    ;
  68:  WAIT (DO[37:OFF:At Transit])    ;
  69:  JMP LBL[999] ;
  70:   ;
  71:  !***At Conv: -90, Mid, Nrml*** ;
  72:  LBL[530] ;
  73:  UFRAME_NUM=0 ;
  74:  UTOOL_NUM=1 ;
  75:J PR[145] 25% CNT10    ;
  76:J PR[5:Trans-Origin] 25% CNT100    ;
  77:  WAIT (DO[37:OFF:At Transit])    ;
  78:  JMP LBL[999] ;
  79:   ;
  80:  !***At Conv: -90, High, Nrml*** ;
  81:  LBL[540] ;
  82:  UFRAME_NUM=0 ;
  83:  UTOOL_NUM=1 ;
  84:J PR[147:Hop2 L-Rack-2] 25% CNT10    ;
  85:J PR[5:Trans-Origin] 25% CNT100    ;
  86:  WAIT (DO[37:OFF:At Transit])    ;
  87:  JMP LBL[999] ;
  88:   ;
  89:   ;
  90:  LBL[999] ;
/POS
/END
