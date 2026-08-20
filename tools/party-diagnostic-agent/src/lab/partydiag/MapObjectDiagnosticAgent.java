package lab.partydiag;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.IdentityHashMap;

/** One-shot inspection of map-owned collections used to locate warp and interaction metadata. */
public final class MapObjectDiagnosticAgent {
  private MapObjectDiagnosticAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation) {
    StringBuilder out=new StringBuilder();
    try {
      Class<?> globals=loaded(instrumentation,"f.Ot");Object session=globals.getField("Z02").get(null);
      Object world=field(session.getClass(),"tE0").get(session);Object player=field(world.getClass(),"cy").get(world);
      Object position=field(player.getClass(),"F61").get(player);Object map=position.getClass().getMethod("WZ0").invoke(position);
      IdentityHashMap<Object,Boolean> seen=new IdentityHashMap<>();
      for(String name:new String[]{"yT","xE1","s2","we","qo0","cA0","lE1","WO1","zV1"})try{Object value=field(map.getClass(),name).get(map);dump(out,"MAP."+name,value,0,seen);}catch(Throwable error){out.append("FIELD_ERROR ").append(name).append(' ').append(error).append('\n');}
    } catch(Throwable error){while(error.getCause()!=null)error=error.getCause();out.append("ERROR ").append(error).append('\n');}
    try{Files.writeString(Path.of(options),Instant.now()+System.lineSeparator()+out);}catch(Throwable ignored){}
  }
  private static void dump(StringBuilder out,String label,Object value,int depth,IdentityHashMap<Object,Boolean> seen){
    if(value==null){out.append(label).append("=null\n");return;}if(depth>3||seen.put(value,Boolean.TRUE)!=null)return;
    Class<?> type=value.getClass();out.append(label).append(" type=").append(type.getName());
    if(type.isArray()){int length=Array.getLength(value);out.append(" length=").append(length).append('\n');for(int i=0;i<Math.min(length,80);i++)dump(out,label+'['+i+']',Array.get(value,i),depth+1,seen);return;}
    out.append(" value=").append(String.valueOf(value)).append('\n');
    if(!type.getName().startsWith("f."))return;
    for(Class<?> cursor=type;cursor!=null&&cursor!=Object.class;cursor=cursor.getSuperclass())for(Field candidate:cursor.getDeclaredFields()){
      if(Modifier.isStatic(candidate.getModifiers())||!candidate.trySetAccessible())continue;try{Object child=candidate.get(value);out.append(label).append('.').append(candidate.getName()).append(':').append(candidate.getType().getTypeName()).append('=');if(child==null||child instanceof Number||child instanceof Boolean||child instanceof CharSequence||child.getClass().isEnum())out.append(String.valueOf(child)).append('\n');else{out.append('<').append(child.getClass().getName()).append(">\n");dump(out,label+'.'+candidate.getName(),child,depth+1,seen);}}catch(Throwable ignored){}
    }
    for(Method method:type.getMethods())if(!Modifier.isStatic(method.getModifiers())&&method.getParameterCount()==0&&(method.getReturnType().isPrimitive()||method.getReturnType()==String.class))try{out.append(label).append(" METHOD ").append(method.getName()).append('=').append(method.invoke(value)).append('\n');}catch(Throwable ignored){}
  }
  private static Field field(Class<?> type,String name)throws Exception{for(Class<?> cursor=type;cursor!=null;cursor=cursor.getSuperclass())try{Field value=cursor.getDeclaredField(name);value.trySetAccessible();return value;}catch(NoSuchFieldException ignored){}throw new NoSuchFieldException(name);}
  private static Class<?> loaded(Instrumentation instrumentation,String name){for(Class<?> type:instrumentation.getAllLoadedClasses())if(type.getName().equals(name))return type;throw new IllegalStateException(name);}
}
