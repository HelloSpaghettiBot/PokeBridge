package lab.snapshotagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

/** Reads the stable map identity and authoritative player tile from the world model. */
public final class WorldMapSnapshotAgent {
  private WorldMapSnapshotAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values=options.split(",",-1);
    new Thread(()->run(Path.of(values[0]),values[1],instrumentation),"world-map-snapshot").start();
  }
  private static void run(Path log,String tag,Instrumentation instrumentation){
    try{
      Class<?> globals=loaded(instrumentation,"f.Ot");
      Object session=globals.getField("Z02").get(null);
      Object world=findField(session.getClass(),"tE0").get(session);
      Object player=findField(world.getClass(),"cy").get(world);
      Object position=findField(player.getClass().getSuperclass(),"F61").get(player);
      short x=findField(position.getClass(),"q90").getShort(position);
      short y=findField(position.getClass(),"sj0").getShort(position);
      byte direction=findField(position.getClass(),"lc1").getByte(position);
      byte mapX=findField(position.getClass(),"Ai").getByte(position);
      byte mapY=findField(position.getClass(),"Nb1").getByte(position);
      byte mapZ=findField(position.getClass(),"ez").getByte(position);
      Object map=position.getClass().getMethod("WZ0").invoke(position);
      String name=map==null?"":String.valueOf(map.getClass().getMethod("U61").invoke(map));
      short id=map==null?-1:(short)map.getClass().getMethod("eA1").invoke(map);
      String positionText=String.valueOf(position.getClass().getMethod("lpt8").invoke(position));
      write(log,"MAP tag="+tag+" key="+mapX+":"+mapY+":"+mapZ+":"+id+" name="+name+" x="+x+" y="+y+" direction="+direction+" position="+positionText);
    }catch(Throwable error){while(error.getCause()!=null)error=error.getCause();write(log,"MAP_ERROR tag="+tag+" "+error);}
  }
  private static Field findField(Class<?> type,String name)throws Exception{for(Class<?> cursor=type;cursor!=null;cursor=cursor.getSuperclass())try{Field field=cursor.getDeclaredField(name);field.trySetAccessible();return field;}catch(NoSuchFieldException ignored){}throw new NoSuchFieldException(name);}
  private static Class<?> loaded(Instrumentation instrumentation,String name){for(Class<?> type:instrumentation.getAllLoadedClasses())if(type.getName().equals(name))return type;throw new IllegalStateException(name);}
  private static synchronized void write(Path path,String message){try{Files.writeString(path,Instant.now()+" "+message+System.lineSeparator(),StandardOpenOption.CREATE,StandardOpenOption.APPEND);}catch(IOException ignored){}}
}
