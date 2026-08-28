/PROG  _BGLOGIC
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "Background Logic";
PROG_SIZE	= 1675;
CREATE		= DATE 19-09-24  TIME 04:34:08;
MODIFIED	= DATE 26-08-07  TIME 15:34:00;
FILE_NAME	= _BGLOGIC;
VERSION		= 0;
LINE_COUNT	= 53;
MEMORY_SIZE	= 2027;
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
   1:  !****CUSTOM BACKGROUND LOGIC***** ;
   2:  !***BGL-Custom Running Chk*** ;
   3:  IF (F[1010:OFF:BGL Chk-Running]) THEN ;
   4:  IF (F[1011:OFF:BGL-Custom Chk]),F[1014:OFF:BGL-Custom Ack]=(ON) ;
   5:  ELSE ;
   6:  F[1014:OFF:BGL-Custom Ack]=(OFF) ;
   7:  ENDIF ;
   8:   ;
   9:  !***Part On Grip Flag*** ;
  10:  F[1:ON :Part in Grip]=(!DI[65:OFF:Clamp Ext-Up] OR !DI[68:ON :Hook Ret-Open]) ;
  11:  !***Set EOAT Tote ID GO*** ;
  12:  GO[2:0:Tote ID in Rob]=R[5:*Grp-ToteID] ;
  13:  !***Set Origin of Tote*** ;
  14:  F[2:OFF:ToteOrig-Convs]=(R[5:*Grp-ToteID]=200 OR R[5:*Grp-ToteID]=201) ;
  15:  F[3:OFF:ToteOrig-Racks]=(R[5:*Grp-ToteID]>=1 AND R[5:*Grp-ToteID]<=168) ;
  16:  !***Save Num Tasks Rdy*** ;
  17:  R[371:*Outfd1 PL Rdy]=(DI[19:OFF:Outfd PL Rdy]) ;
  18:  R[372:*ReconPL Rdy]=(DI[20:OFF:Recon PL Rdy]) ;
  19:  R[373:*RackPL Rdy]=(DI[22:OFF:RackPL Rdy]) ;
  20:  R[374:*Hopper Rdy]=(DI[23:OFF:Hopper Rdy]) ;
  21:  R[375:*RjctPL Rdy]=(DI[28:OFF:Reject PL Cmd]) ;
  22:  R[370:*Num Tasks Rdy]=R[371:*Outfd1 PL Rdy]+R[372:*ReconPL Rdy]+R[373:*RackPL Rdy]+R[374:*Hopper Rdy]+R[375:*RjctPL Rdy]    ;
  23:  F[7:OFF:Mult Tasks Rdy]=(R[370:*Num Tasks Rdy]>1) ;
  24:  !***At RefPos Flag*** ;
  25:  F[5:ON :At RefPos]=(DO[33:OFF:At Home] OR DO[34:OFF:At TL Maint] OR DO[35:OFF:At Safe] OR DO[36:OFF:At Zero] OR DO[37:OFF:At Transit] OR DO[201:OFF:At Conv1/3 Appr] OR DO[202:OFF:At Recon Appr] OR 
    :  DO[203:OFF:At Scan Pos] OR DO[204:OFF:At Inspct Pos] OR DO[205:OFF:At Hopper Appr] OR DO[206:OFF:At Dump Pos] OR DO[207:OFF:At Dump-Divide Pos] OR DO[208:OFF:At Reject Appr] OR DO[211:ON :At L-RacksApr] OR 
    :  DO[212:OFF:At R-RacksApr]) ;
  26:  !***Set At DCS Zn Flags*** ;
  27:  F[501:OFF:DCS-At Hopper]=($DCSS_PSTAT.$STATUS_CPC[11]) ;
  28:  F[502:OFF:DCS-At Infd1]=($DCSS_PSTAT.$STATUS_CPC[12]) ;
  29:  F[503:OFF:DCS-At Recon In]=($DCSS_PSTAT.$STATUS_CPC[13]) ;
  30:  F[504:OFF:DCS-At Outfd1]=($DCSS_PSTAT.$STATUS_CPC[14]) ;
  31:  F[505:OFF:DCS-At Recon Out]=($DCSS_PSTAT.$STATUS_CPC[15]) ;
  32:  !***Set DCS-At Station DOs*** ;
  33:  DO[38:OFF:At Hopper]=(F[501:OFF:DCS-At Hopper]) ;
  34:  DO[39:OFF:At Infd]=(F[502:OFF:DCS-At Infd1]) ;
  35:  DO[40:OFF:At Infd Recon]=(F[503:OFF:DCS-At Recon In]) ;
  36:  DO[41:OFF:At Outfd]=(F[504:OFF:DCS-At Outfd1]) ;
  37:  DO[42:OFF:At Outfd Recon]=(F[505:OFF:DCS-At Recon Out]) ;
  38:  DO[44:OFF:At Scanner]=(DO[203:OFF:At Scan Pos]) ;
  39:  !***Set At Reject Flag/DO*** ;
  40:  R[380:DCS-RjctZn-Sts]=($DCSS_PSTAT.$STATUS_CPC[16]) ;
  41:  F[506:OFF:DCS-At Rjct]=(R[380:DCS-RjctZn-Sts]<>0 AND R[380:DCS-RjctZn-Sts]<>6) ;
  42:  DO[43:OFF:At Reject]=(F[506:OFF:DCS-At Rjct]) ;
  43:  !***Turn OFF Hopper DOs*** ;
  44:  IF ((!DO[206:OFF:At Dump Pos] AND !DO[207:OFF:At Dump-Divide Pos]) AND (DO[23:OFF:Tote in Pos] OR DO[24:OFF:Dump Dn Ack])) THEN ;
  45:  R[395:*BGL-HopOffTm]=R[395:*BGL-HopOffTm]+.008    ;
  46:  IF (R[395:*BGL-HopOffTm]>3) THEN ;
  47:  DO[23:OFF:Tote in Pos]=OFF ;
  48:  DO[24:OFF:Dump Dn Ack]=OFF ;
  49:  ENDIF ;
  50:  ELSE ;
  51:  R[395:*BGL-HopOffTm]=0    ;
  52:  ENDIF ;
  53:   ;
/POS
/END
