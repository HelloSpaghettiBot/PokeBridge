package lab.catchagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.IdentityHashMap;

/** Lists the live region inventory using the official inventory model. */
public final class InventoryAgent {
  private InventoryAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = options.split(",", -1);
    new Thread(() -> run(Path.of(values[0]), values[2], instrumentation), "bridge-inventory-agent").start();
  }
  private static void run(Path log, String tag, Instrumentation instrumentation) {
    try {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      Object ui = find(globals.getField("B21").get(null), "f.h60", 0, new IdentityHashMap<>());
      Object panel = ui.getClass().getField("eR0").get(ui);
      Object region = panel.getClass().getField("NS1").get(panel);
      Object session = globals.getField("Z02").get(null);
      Object inventory = session.getClass().getMethod("kH", region.getClass()).invoke(session, region);
      Object stacks = inventory.getClass().getMethod("EA1").invoke(inventory);
      write(log, "INVENTORY_BEGIN tag=" + tag + " count=" + Array.getLength(stacks));
      for (int i = 0; i < Array.getLength(stacks); i++) {
        Object stack = Array.get(stacks, i);
        Object item = stack.getClass().getField("Ub0").get(stack);
        short id = item.getClass().getField("XH").getShort(item);
        short quantity = (short) stack.getClass().getMethod("QF").invoke(stack);
        String name = String.valueOf(stack.getClass().getMethod("Mh1").invoke(stack));
        write(log, "ITEM id=" + id + " quantity=" + quantity + " name=" + name);
      }
      write(log, "INVENTORY_END tag=" + tag);
    } catch (Throwable error) { while (error.getCause()!=null) error=error.getCause(); write(log, "INVENTORY_ERROR tag=" + tag + " " + error); }
  }
  private static Object find(Object value,String name,int depth,IdentityHashMap<Object,Boolean> seen){
    if(value==null||depth>6||seen.put(value,Boolean.TRUE)!=null)return null;if(value.getClass().getName().equals(name))return value;
    if(value.getClass().isArray()){for(int i=0;i<Math.min(Array.getLength(value),30);i++){Object found=find(Array.get(value,i),name,depth+1,seen);if(found!=null)return found;}return null;}
    if(!value.getClass().getName().startsWith("f."))return null;
    for(Class<?> cursor=value.getClass();cursor!=null&&cursor!=Object.class;cursor=cursor.getSuperclass())for(Field field:cursor.getDeclaredFields()){if(Modifier.isStatic(field.getModifiers())||!field.trySetAccessible())continue;try{Object found=find(field.get(value),name,depth+1,seen);if(found!=null)return found;}catch(Throwable ignored){}}
    return null;
  }
  private static Class<?> loaded(Instrumentation instrumentation,String name){for(Class<?> type:instrumentation.getAllLoadedClasses())if(type.getName().equals(name))return type;throw new IllegalStateException(name);}
  private static synchronized void write(Path path,String message){try{Files.writeString(path,Instant.now()+" "+message+System.lineSeparator(),StandardOpenOption.CREATE,StandardOpenOption.APPEND);}catch(IOException ignored){}}
}
