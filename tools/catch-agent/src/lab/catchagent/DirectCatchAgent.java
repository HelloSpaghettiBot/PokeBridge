package lab.catchagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.IdentityHashMap;

/** Queues an inventory-backed item action without requiring the bag widget to be open. */
public final class DirectCatchAgent {
  private DirectCatchAgent() {}
  public static void agentmain(String options,Instrumentation instrumentation){String[] values=options.split(",",-1);new Thread(()->run(Path.of(values[0]),Short.parseShort(values[1]),values[2],instrumentation),"direct-catch-agent").start();}
  private static void run(Path log,short itemId,String tag,Instrumentation instrumentation){try{
    Class<?> globals=loaded(instrumentation,"f.Ot"),sessionType=loaded(instrumentation,"f.ln1"),packetType=loaded(instrumentation,"f.z30"),actorType=loaded(instrumentation,"f.fd1"),stackType=loaded(instrumentation,"f.rr"),tokenType=loaded(instrumentation,"f.jK1"),connectionType=loaded(instrumentation,"f.hU");
    Object session=globals.getField("Z02").get(null),region=findField(session.getClass(),"Ae0").get(session),inventory=session.getClass().getMethod("kH",region.getClass()).invoke(session,region),stack=inventory.getClass().getMethod("aX0",short.class).invoke(inventory,itemId);
    if(stack==null)throw new IllegalStateException("No inventory stack for item "+itemId);
    // A recorded BAG -> Poke Ball action serializes an all-zero jK1 token.
    // The client's static e0 object is not reliably zero after initialization,
    // so create a fresh value object and explicitly clear its serialized field.
    Object neutralToken=newToken(tokenType);
    Object ui=find(globals.getField("B21").get(null),"f.h60",0,new IdentityHashMap<>());
    if(ui==null)throw new IllegalStateException("Battle UI not found");
    Object actor=findField(ui.getClass(),"vN").get(ui);
    if(actor==null)throw new IllegalStateException("Battle actor not selected");
    Constructor<?> constructor=packetType.getConstructor(actorType,stackType,tokenType,byte.class);Object packet=constructor.newInstance(actor,stack,neutralToken,(byte)-1);
    // Queue the exact recorded action: actor=0, item=5004, token=0, target=-1.
    Method queue=connectionType.getMethod("wx1",loaded(instrumentation,"f.Uu1"));queue.invoke(sessionType.getField("bf").get(session),packet);
    write(log,"DIRECT_CATCH_SENT tag="+tag+" itemId="+itemId+" name="+stack.getClass().getMethod("Mh1").invoke(stack));
  }catch(Throwable error){while(error.getCause()!=null)error=error.getCause();write(log,"DIRECT_CATCH_ERROR tag="+tag+" "+error);}}
  private static Field findField(Class<?> type,String name)throws Exception{for(Class<?> cursor=type;cursor!=null;cursor=cursor.getSuperclass())try{Field field=cursor.getDeclaredField(name);field.trySetAccessible();return field;}catch(NoSuchFieldException ignored){}throw new NoSuchFieldException(name);}
  private static Object newToken(Class<?> tokenType)throws Exception{
    Field serialized=findField(tokenType,"CW1");
    for(Field field:tokenType.getDeclaredFields()){
      if(!Modifier.isStatic(field.getModifiers())||!tokenType.isAssignableFrom(field.getType())||!field.trySetAccessible())continue;
      Object candidate=field.get(null);
      if(candidate!=null&&serialized.getLong(candidate)==0L)return candidate;
    }
    for(Constructor<?> constructor:tokenType.getDeclaredConstructors()){
      if(!constructor.trySetAccessible())continue;
      Class<?>[] types=constructor.getParameterTypes();Object[] args=new Object[types.length];
      boolean supported=true;
      for(int i=0;i<types.length;i++){
        if(!types[i].isPrimitive())args[i]=null;
        else if(types[i]==boolean.class)args[i]=false;
        else if(types[i]==byte.class)args[i]=(byte)0;
        else if(types[i]==short.class)args[i]=(short)0;
        else if(types[i]==int.class)args[i]=0;
        else if(types[i]==long.class)args[i]=0L;
        else if(types[i]==float.class)args[i]=0F;
        else if(types[i]==double.class)args[i]=0D;
        else if(types[i]==char.class)args[i]=(char)0;
        else supported=false;
      }
      if(!supported)continue;
      try{Object token=constructor.newInstance(args);serialized.setLong(token,0L);if(serialized.getLong(token)==0L)return token;}catch(Throwable ignored){}
    }
    throw new IllegalStateException("Unable to construct zero jK1 token");
  }
  private static Object find(Object value,String name,int depth,IdentityHashMap<Object,Boolean> seen){
    if(value==null||depth>6||seen.put(value,Boolean.TRUE)!=null)return null;
    if(value.getClass().getName().equals(name))return value;
    if(value.getClass().isArray()){for(int i=0;i<Math.min(Array.getLength(value),30);i++){Object found=find(Array.get(value,i),name,depth+1,seen);if(found!=null)return found;}return null;}
    if(!value.getClass().getName().startsWith("f."))return null;
    for(Class<?> cursor=value.getClass();cursor!=null&&cursor!=Object.class;cursor=cursor.getSuperclass())for(Field field:cursor.getDeclaredFields()){
      if(Modifier.isStatic(field.getModifiers())||!field.trySetAccessible())continue;
      try{Object found=find(field.get(value),name,depth+1,seen);if(found!=null)return found;}catch(Throwable ignored){}
    }
    return null;
  }
  private static Class<?> loaded(Instrumentation instrumentation,String name){for(Class<?> type:instrumentation.getAllLoadedClasses())if(type.getName().equals(name))return type;throw new IllegalStateException(name);}
  private static synchronized void write(Path path,String message){try{Files.writeString(path,Instant.now()+" "+message+System.lineSeparator(),StandardOpenOption.CREATE,StandardOpenOption.APPEND);}catch(IOException ignored){}}
}
