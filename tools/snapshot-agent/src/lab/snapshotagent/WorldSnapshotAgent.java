package lab.snapshotagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.Arrays;

/** One-shot dump of world/map state used to identify stable navigation fields. */
public final class WorldSnapshotAgent {
  private WorldSnapshotAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = options.split(",", -1);
    new Thread(() -> run(Path.of(values[0]), values[1], instrumentation), "world-snapshot").start();
  }
  private static void run(Path log, String tag, Instrumentation instrumentation) {
    try {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      Object session = globals.getField("Z02").get(null);
      write(log, "WORLD_BEGIN tag=" + tag + " session=" + session.getClass().getName());
      dump(log, "SESSION", session, true);
      for (String name : new String[]{"J2","wg1","YC1","Zi0","cl1","ZA0","LY1","Ae0","Dv1","strictfp","F8","tn1"}) {
        try {
          Field field = findField(session.getClass(), name);
          field.trySetAccessible();
          dump(log, "NESTED field=" + name, field.get(session), false);
        } catch (Throwable error) { write(log, "NESTED_ERROR field=" + name + " " + error); }
      }
      write(log, "WORLD_END tag=" + tag);
    } catch (Throwable error) { while(error.getCause()!=null)error=error.getCause(); write(log,"WORLD_ERROR tag="+tag+" "+error); }
  }
  private static void dump(Path log, String label, Object value, boolean includeObjectTypes) throws Exception {
    if (value == null) { write(log, label + " null"); return; }
    StringBuilder text = new StringBuilder(label).append(" type=").append(value.getClass().getName());
    for (Class<?> cursor=value.getClass();cursor!=null&&cursor!=Object.class;cursor=cursor.getSuperclass()) {
      for (Field field:cursor.getDeclaredFields()) {
        if(Modifier.isStatic(field.getModifiers())||!field.trySetAccessible())continue;
        Object item=field.get(value);
        if(item==null||item instanceof Number||item instanceof Boolean||item instanceof String||item instanceof Character) text.append(' ').append(field.getName()).append('=').append(item);
        else if(item instanceof byte[] bytes) text.append(' ').append(field.getName()).append('=').append(Arrays.toString(bytes));
        else if(item instanceof short[] shorts) text.append(' ').append(field.getName()).append('=').append(Arrays.toString(shorts));
        else if(includeObjectTypes && item.getClass().getName().startsWith("f.")) text.append(' ').append(field.getName()).append("=<").append(item.getClass().getName()).append('>');
      }
    }
    write(log,text.toString());
  }
  private static Field findField(Class<?> type,String name)throws Exception{for(Class<?> cursor=type;cursor!=null;cursor=cursor.getSuperclass())try{return cursor.getDeclaredField(name);}catch(NoSuchFieldException ignored){}throw new NoSuchFieldException(name);}
  private static Class<?> loaded(Instrumentation instrumentation,String name){for(Class<?> type:instrumentation.getAllLoadedClasses())if(type.getName().equals(name))return type;throw new IllegalStateException(name);}
  private static synchronized void write(Path path,String message){try{Files.writeString(path,Instant.now()+" "+message+System.lineSeparator(),StandardOpenOption.CREATE,StandardOpenOption.APPEND);}catch(IOException ignored){}}
}
