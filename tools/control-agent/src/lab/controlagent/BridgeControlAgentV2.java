package lab.controlagent;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.IdentityHashMap;

/** Persistent navigation, battle, identification, and inventory control endpoint. */
public final class BridgeControlAgentV2 {
  private static volatile boolean started;
  private BridgeControlAgentV2() {}

  public static synchronized void agentmain(String options, Instrumentation instrumentation) {
    if (started) return;
    String[] values=(options==null?"":options).split(",",-1);
    if(values.length!=3)throw new IllegalArgumentException("Expected LOG_PATH,PORT,TAG");
    started=true;
    new Thread(()->serve(Path.of(values[0]),Integer.parseInt(values[1]),values[2],instrumentation),"bridge-control-v2").start();
  }

  private static void serve(Path log,int port,String tag,Instrumentation instrumentation){
    try{
      Actions actions=new Actions(instrumentation);
      try(ServerSocket server=new ServerSocket(port,8,InetAddress.getLoopbackAddress())){
        write(log,"listening_v2 tag="+tag+" port="+port);
        while(!server.isClosed())try(Socket socket=server.accept();BufferedReader reader=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));PrintWriter writer=new PrintWriter(socket.getOutputStream(),true,StandardCharsets.UTF_8)){
          String line;while((line=reader.readLine())!=null)try{String response=execute(actions,line);writer.println("OK "+response);write(log,"command="+line+" response="+response);}catch(Throwable error){while(error.getCause()!=null)error=error.getCause();writer.println("ERR "+error);write(log,"command_error="+line+" error="+error);}
        }catch(IOException error){write(log,"client_error="+error);}
      }
    }catch(Throwable error){started=false;write(log,"server_error="+error);}
  }

  private static String execute(Actions actions,String line)throws Exception{
    String[] parts=line.trim().split("\\s+");
    return switch(parts[0].toUpperCase()){
      case "PING"->"PONG V2";
      case "STATE"->actions.inBattle()?"BATTLE":"OVERWORLD";
      case "WORLD"->actions.world();
      case "TILE"->actions.tile();
      case "MAPGRID"->actions.mapGrid();
      case "IDENTIFY"->actions.identify();
      case "INVENTORY"->actions.inventory();
      case "PROGRESS"->actions.progress();
      case "MOVE"->{if(parts.length!=2)throw new IllegalArgumentException("MOVE direction");byte direction=Byte.parseByte(parts[1]);if(actions.inBattle())yield "SKIPPED_BATTLE "+actions.world();actions.move(direction);yield "MOVED "+direction+" "+actions.world();}
      case "AUTO"->{if(!actions.inBattle())yield "SKIPPED_OVERWORLD";yield actions.autoMove();}
      case "CATCH"->{if(parts.length!=2)throw new IllegalArgumentException("CATCH itemId");if(!actions.inBattle())yield "SKIPPED_OVERWORLD";yield actions.catchWith(Short.parseShort(parts[1]));}
      default->throw new IllegalArgumentException("Unknown command: "+parts[0]);
    };
  }

  private static final class Actions{
    final Field sessionField;
    final Field battleField;
    final Method moveMethod;
    final Class<?> packetType;
    final Constructor<?> movePacket;
    final Method queue;
    final Field connection;

    Actions(Instrumentation instrumentation)throws Exception{
      Class<?> globals=loaded(instrumentation,"f.Ot");
      sessionField=globals.getField("Z02");
      battleField=globals.getField("Bu");
      Class<?> sessionType=loaded(instrumentation,"f.ln1");
      packetType=loaded(instrumentation,"f.z30");
      movePacket=findConstructor(packetType,parameters->parameters.length==3&&parameters[1]==short.class&&parameters[2]==byte.class);
      Class<?> connectionType=loaded(instrumentation,"f.hU");
      queue=connectionType.getMethod("wx1",loaded(instrumentation,"f.Uu1"));
      connection=sessionType.getField("bf");
      moveMethod=sessionType.getMethod("bI",byte.class,boolean.class,boolean.class);
    }
    Object session()throws Exception{Object value=sessionField.get(null);if(value==null)throw new IllegalStateException("NO_ACTIVE_SESSION");return value;}
    boolean inBattle()throws Exception{return battleField.get(null)!=null;}
    void move(byte direction)throws Exception{if(direction<0||direction>3)throw new IllegalArgumentException("Direction 0..3");moveMethod.invoke(session(),direction,false,false);}

    String world()throws Exception{
      Object session=session();
      Object world=findField(session.getClass(),"tE0").get(session);
      Object player=findField(world.getClass(),"cy").get(world);
      Object position=findField(player.getClass(),"F61").get(player);
      short x=findField(position.getClass(),"q90").getShort(position),y=findField(position.getClass(),"sj0").getShort(position);
      byte direction=findField(position.getClass(),"lc1").getByte(position),mx=findField(position.getClass(),"Ai").getByte(position),my=findField(position.getClass(),"Nb1").getByte(position),mz=findField(position.getClass(),"ez").getByte(position);
      Object map=position.getClass().getMethod("WZ0").invoke(position);
      String name=map==null?"":String.valueOf(map.getClass().getMethod("U61").invoke(map)).replace(' ','_');
      short id=map==null?-1:(short)map.getClass().getMethod("eA1").invoke(map);
      return "map="+mx+":"+my+":"+mz+":"+id+" name="+name+" x="+x+" y="+y+" direction="+direction;
    }

    String tile()throws Exception{
      Object session=session();
      Object world=findField(session.getClass(),"tE0").get(session);
      Object player=findField(world.getClass(),"cy").get(world);
      Object wrapper=findField(player.getClass(),"F61").get(player);
      Object coordinate=wrapper.getClass().getMethod("lu1").invoke(wrapper);
      if(coordinate==null)return "NO_TILE";
      short terrain=((Number)coordinate.getClass().getMethod("WU1").invoke(coordinate)).shortValue();
      byte behavior=((Number)coordinate.getClass().getMethod("Gh0").invoke(coordinate)).byteValue();
      byte z=((Number)coordinate.getClass().getMethod("Xd0").invoke(coordinate)).byteValue();
      String coordinateClass=coordinate.getClass().getName();
      String signature=coordinateClass+":"+Short.toUnsignedInt(terrain)+":"+Byte.toUnsignedInt(behavior);
      return "TILE class="+coordinateClass+" terrainId="+Short.toUnsignedInt(terrain)+" behaviorId="+Byte.toUnsignedInt(behavior)+" z="+Byte.toUnsignedInt(z)+" signature="+signature;
    }

    String mapGrid()throws Exception{
      Object session=session();
      Object world=findField(session.getClass(),"tE0").get(session);
      Object player=findField(world.getClass(),"cy").get(world);
      Object position=findField(player.getClass(),"F61").get(player);
      Object map=position.getClass().getMethod("WZ0").invoke(position);
      if(map==null)return "NO_MAP";
      int width=((Number)map.getClass().getMethod("En").invoke(map)).intValue();
      int height=((Number)map.getClass().getMethod("A8").invoke(map)).intValue();
      String mapKey=Byte.toUnsignedInt(findField(position.getClass(),"Ai").getByte(position))+":"
        +Byte.toUnsignedInt(findField(position.getClass(),"Nb1").getByte(position))+":"
        +Byte.toUnsignedInt(findField(position.getClass(),"ez").getByte(position))+":"
        +Short.toUnsignedInt(((Number)map.getClass().getMethod("eA1").invoke(map)).shortValue());
      String name=String.valueOf(map.getClass().getMethod("U61").invoke(map)).replace(' ','_');
      Method tileAt=map.getClass().getMethod("ky1",int.class,int.class);
      Method movementTileAt=map.getClass().getMethod("k00",short.class,short.class,float.class);
      Class<?> coordinateType=Class.forName("f.iM0",false,map.getClass().getClassLoader());
      Method leaves=coordinateType.getMethod("O11",coordinateType,Class.forName("f.ti",false,map.getClass().getClassLoader()),byte.class,byte.class);
      Method enters=coordinateType.getMethod("Os",coordinateType,Class.forName("f.ti",false,map.getClass().getClassLoader()),byte.class,byte.class);
      Class<?> actorType=Class.forName("f.ti",false,map.getClass().getClassLoader());
      StringBuilder result=new StringBuilder("MAPGRID map=").append(mapKey).append(" name=").append(name)
        .append(" width=").append(width).append(" height=").append(height).append(" tiles=");
      boolean first=true;
      for(int y=0;y<height;y++)for(int x=0;x<width;x++){
        Object tile=tileAt.invoke(map,x,y);if(tile==null)continue;
        int z=((Number)tile.getClass().getMethod("Xd0").invoke(tile)).byteValue();
        int terrain=Short.toUnsignedInt(((Number)tile.getClass().getMethod("WU1").invoke(tile)).shortValue());
        int behavior=Byte.toUnsignedInt(((Number)tile.getClass().getMethod("Gh0").invoke(tile)).byteValue());
        int pass=0;
        for(byte direction=0;direction<4;direction++){
          int nx=x+(direction==3?1:direction==2?-1:0),ny=y+(direction==0?1:direction==1?-1:0);
          float elevation=((Number)tile.getClass().getMethod("W3").invoke(tile)).floatValue();
          Object target=nx<0||ny<0||nx>=width||ny>=height?null:movementTileAt.invoke(map,(short)nx,(short)ny,elevation);
          boolean blocked=target==null;
          if(!blocked){
            Object sourceBehavior=tile.getClass().getMethod("Wl1").invoke(tile),targetBehavior=target.getClass().getMethod("Wl1").invoke(target);
            byte sourceZ=((Number)tile.getClass().getMethod("Xd0").invoke(tile)).byteValue(),targetZ=((Number)target.getClass().getMethod("Xd0").invoke(target)).byteValue();
            boolean compatibleLayer=sourceZ==targetZ||(sourceZ==0&&targetZ==2)||sourceZ==-1||targetZ==-1||targetZ==14||targetZ==-2;
            blocked=(Boolean)target.getClass().getMethod("iA0").invoke(target)
              ||(Boolean)sourceBehavior.getClass().getMethod("iZ0",byte.class).invoke(sourceBehavior,direction)
              ||(Boolean)sourceBehavior.getClass().getMethod("rH",byte.class).invoke(sourceBehavior,direction)
              ||(Boolean)targetBehavior.getClass().getMethod("e91",coordinateType,actorType,byte.class,byte.class).invoke(targetBehavior,target,player,direction,(byte)0)
              ||!compatibleLayer
              ||(Boolean)leaves.invoke(tile,target,player,direction,(byte)0)
              ||(Boolean)enters.invoke(target,tile,player,direction,(byte)0);
          }
          if(!blocked)pass|=1<<direction;
        }
        int flags=0;
        if((Boolean)tile.getClass().getMethod("ch0").invoke(tile))flags|=1;
        if((Boolean)tile.getClass().getMethod("iA0").invoke(tile))flags|=2;
        String kind=String.valueOf(tile.getClass().getMethod("Wl1").invoke(tile).getClass().getSimpleName());
        if(!first)result.append(';');first=false;
        result.append(x).append(',').append(y).append(',').append(z).append(',').append(terrain).append(',').append(behavior).append(',').append(pass).append(',').append(flags).append(',').append(kind);
      }
      return result.toString();
    }

    String autoMove()throws Exception{
      Object battle=battleField.get(null),ui=battleUi();
      Object actor=ui.getClass().getField("vN").get(ui);
      byte side=findField(actor.getClass(),"Ye1").getByte(actor),slot=findField(actor.getClass(),"cOM1").getByte(actor);
      Object pokemon=battle.getClass().getMethod("Dp",byte.class,byte.class).invoke(battle,side,slot);
      short[] ids=(short[])pokemon.getClass().getMethod("Fj1").invoke(pokemon);
      byte[] pp=(byte[])pokemon.getClass().getMethod("HB1").invoke(pokemon);
      Object definitions=ui.getClass().getField("jg1").get(ui);
      int best=-1,bestPower=-1;
      for(int index=0;index<Math.min(ids.length,Array.getLength(definitions));index++){
        Object definition=Array.get(definitions,index);if(definition==null||ids[index]<=0||pp[index]<=0)continue;
        int power=findField(definition.getClass(),"XZ").getShort(definition);
        if(power>bestPower){best=index;bestPower=power;}
      }
      if(best<0||bestPower<=0)return "NO_DAMAGE_PP species="+pokemon.getClass().getMethod("M81").invoke(pokemon);
      Object definition=Array.get(definitions,best);
      String name=String.valueOf(definition.getClass().getMethod("lw1").invoke(definition)).replace(' ','_');
      Object packet=movePacket.newInstance(actor,ids[best],(byte)0);
      Object session=session();queue.invoke(connection.get(session),packet);
      return "AUTO_MOVE moveId="+ids[best]+" name="+name+" pp="+pp[best]+" power="+bestPower;
    }

    String identify()throws Exception{
      Object battle=battleField.get(null);if(battle==null)return "NO_BATTLE";
      Object matrix=battle.getClass().getField("dO").get(battle),enemy=null;
      if(Array.getLength(matrix)>1){Object row=Array.get(matrix,1);for(int i=0;i<Array.getLength(row);i++){enemy=Array.get(row,i);if(enemy!=null)break;}}
      if(enemy==null)return "NO_ENEMY";
      String species=String.valueOf(enemy.getClass().getMethod("M81").invoke(enemy)).replace(' ','_');
      short speciesId=findField(enemy.getClass(),"w71").getShort(enemy);byte level=findField(enemy.getClass(),"zv0").getByte(enemy);
      short current=(short)enemy.getClass().getMethod("Kh").invoke(enemy);
      Object model=enemy.getClass().getField("ZU").get(enemy);short maximum=findField(model.getClass(),"NV0").getShort(model);
      return "ENEMY species="+species+" speciesId="+speciesId+" level="+level+" hp="+current+" maxHp="+maximum+" ivs=UNKNOWN_PRE_CATCH";
    }

    String inventory()throws Exception{
      Object inventory=currentInventory();Object stacks=inventory.getClass().getMethod("EA1").invoke(inventory);StringBuilder result=new StringBuilder("ITEMS");
      for(int i=0;i<Array.getLength(stacks);i++){Object stack=Array.get(stacks,i),item=stack.getClass().getField("Ub0").get(stack);short id=findField(item.getClass(),"XH").getShort(item),quantity=(short)stack.getClass().getMethod("QF").invoke(stack);String name=String.valueOf(stack.getClass().getMethod("Mh1").invoke(stack)).replace(' ','_');result.append('|').append(id).append(':').append(quantity).append(':').append(name);}
      return result.toString();
    }

    String catchWith(short itemId)throws Exception{
      Object inventory=currentInventory(),stack=inventory.getClass().getMethod("aX0",short.class).invoke(inventory,itemId);
      if(stack==null)return "NO_ITEM itemId="+itemId;
      Object item=stack.getClass().getField("Ub0").get(stack),token=item.getClass().getField("jD1").get(item),ui=battleUi();
      ui.getClass().getMethod("JZ0",stack.getClass(),token.getClass(),byte.class).invoke(ui,stack,token,(byte)-1);
      return "CATCH_SENT itemId="+itemId+" name="+String.valueOf(stack.getClass().getMethod("Mh1").invoke(stack)).replace(' ','_');
    }

    Object currentInventory()throws Exception{
      Object session=session();
      Object region=findField(session.getClass(),"Ae0").get(session);
      return session.getClass().getMethod("kH",region.getClass()).invoke(session,region);
    }
    String progress()throws Exception{
      Object session=session();
      Class<?> globals=Class.forName("f.Ot",false,session.getClass().getClassLoader());
      Object screen=globals.getField("B21").get(null);
      String text=findProgressText(screen,0,new IdentityHashMap<>());
      if(text==null)return "PROGRESS levelCap=UNKNOWN";
      java.util.regex.Matcher matcher=java.util.regex.Pattern.compile("(?i)(?:max\\s+)?obedience[^0-9]{0,20}(?:lv\\.?\\s*)?(20|26|32|37|46|47|50|55|62|100)").matcher(text);
      if(!matcher.find())return "PROGRESS levelCap=UNKNOWN";
      return "PROGRESS levelCap="+matcher.group(1);
    }
    Object battleUi()throws Exception{
      Object session=session();
      Class<?> globals=Class.forName("f.Ot",false,session.getClass().getClassLoader());Object screen=globals.getField("B21").get(null);Object ui=findByType(screen,"f.h60",0,new IdentityHashMap<>());if(ui==null)throw new IllegalStateException("Battle UI unavailable");return ui;
    }
  }

  private static String findProgressText(Object value,int depth,IdentityHashMap<Object,Boolean> seen){
    if(value==null||depth>12)return null;
    if(value instanceof CharSequence){String text=value.toString();return text.toLowerCase(java.util.Locale.ROOT).contains("obedience")?text:null;}
    if(seen.put(value,Boolean.TRUE)!=null)return null;
    Class<?> type=value.getClass();
    if(type.isArray()){if(type.getComponentType().isPrimitive())return null;for(int i=0;i<Math.min(Array.getLength(value),80);i++){String found=findProgressText(Array.get(value,i),depth+1,seen);if(found!=null)return found;}return null;}
    if(value instanceof java.util.Collection<?>){for(Object child:(java.util.Collection<?>)value){String found=findProgressText(child,depth+1,seen);if(found!=null)return found;}return null;}
    if(value instanceof java.util.Map<?,?>){for(Object child:((java.util.Map<?,?>)value).values()){String found=findProgressText(child,depth+1,seen);if(found!=null)return found;}return null;}
    if(!type.getName().startsWith("f."))return null;
    for(Class<?> cursor=type;cursor!=null&&cursor!=Object.class;cursor=cursor.getSuperclass())for(Field field:cursor.getDeclaredFields()){
      if(Modifier.isStatic(field.getModifiers())||!field.trySetAccessible())continue;
      try{String found=findProgressText(field.get(value),depth+1,seen);if(found!=null)return found;}catch(Throwable ignored){}
    }
    return null;
  }

  private static Object findByType(Object value,String name,int depth,IdentityHashMap<Object,Boolean> seen){if(value==null||depth>6||seen.put(value,Boolean.TRUE)!=null)return null;if(value.getClass().getName().equals(name))return value;if(value.getClass().isArray()){for(int i=0;i<Math.min(Array.getLength(value),30);i++){Object found=findByType(Array.get(value,i),name,depth+1,seen);if(found!=null)return found;}return null;}if(!value.getClass().getName().startsWith("f."))return null;for(Class<?> cursor=value.getClass();cursor!=null&&cursor!=Object.class;cursor=cursor.getSuperclass())for(Field field:cursor.getDeclaredFields()){if(Modifier.isStatic(field.getModifiers())||!field.trySetAccessible())continue;try{Object found=findByType(field.get(value),name,depth+1,seen);if(found!=null)return found;}catch(Throwable ignored){}}return null;}
  private static Field findField(Class<?> type,String name)throws Exception{for(Class<?> cursor=type;cursor!=null;cursor=cursor.getSuperclass())try{Field field=cursor.getDeclaredField(name);field.trySetAccessible();return field;}catch(NoSuchFieldException ignored){}throw new NoSuchFieldException(name);}
  private static Constructor<?> findConstructor(Class<?> type,java.util.function.Predicate<Class<?>[]> match)throws NoSuchMethodException{for(Constructor<?> constructor:type.getConstructors())if(match.test(constructor.getParameterTypes()))return constructor;throw new NoSuchMethodException(type.getName()+" compatible constructor");}
  private static Class<?> loaded(Instrumentation instrumentation,String name){ClassLoader loader=null;for(Class<?> type:instrumentation.getAllLoadedClasses()){if(type.getName().equals(name))return type;if(type.getName().equals("f.Ot"))loader=type.getClassLoader();}try{return Class.forName(name,false,loader);}catch(ClassNotFoundException error){throw new IllegalStateException(name,error);}}
  private static synchronized void write(Path path,String message){try{Files.writeString(path,Instant.now()+" "+message+System.lineSeparator(),StandardOpenOption.CREATE,StandardOpenOption.APPEND);}catch(IOException ignored){}}
}
