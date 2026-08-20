package lab.switchagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

/** Queues the official party-switch battle action. */
public final class SwitchAgent {
  private SwitchAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values=options.split(",",-1);
    new Thread(()->run(Path.of(values[0]),Short.parseShort(values[1]),values[2],instrumentation),"bridge-switch-agent").start();
  }
  private static void run(Path log,short slot,String tag,Instrumentation instrumentation){
    try{
      Class<?> globals=loaded(instrumentation,"f.Ot"),sessionType=loaded(instrumentation,"f.ln1"),packetType=loaded(instrumentation,"f.z30"),actorType=loaded(instrumentation,"f.fd1"),actionType=loaded(instrumentation,"f.sV"),connectionType=loaded(instrumentation,"f.hU");
      Object session=globals.getField("Z02").get(null),action=actionType.getField("kb").get(null);
      Constructor<?> constructor=packetType.getConstructor(actorType,actionType,short.class);
      Object packet=constructor.newInstance(null,action,slot);
      Field connection=sessionType.getField("bf");
      Method queue=connectionType.getMethod("wx1",loaded(instrumentation,"f.Uu1"));
      queue.invoke(connection.get(session),packet);
      write(log,"SWITCH_SENT tag="+tag+" slot="+slot);
    }catch(Throwable error){while(error.getCause()!=null)error=error.getCause();write(log,"SWITCH_ERROR tag="+tag+" "+error);}
  }
  private static Class<?> loaded(Instrumentation instrumentation,String name){for(Class<?> type:instrumentation.getAllLoadedClasses())if(type.getName().equals(name))return type;throw new IllegalStateException(name);}
  private static synchronized void write(Path path,String message){try{Files.writeString(path,Instant.now()+" "+message+System.lineSeparator(),StandardOpenOption.CREATE,StandardOpenOption.APPEND);}catch(IOException ignored){}}
}
