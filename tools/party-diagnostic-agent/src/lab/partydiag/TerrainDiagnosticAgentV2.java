package lab.partydiag;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** Focused reflection inventory for the current region coordinate implementation. */
public final class TerrainDiagnosticAgentV2 {
  private TerrainDiagnosticAgentV2() {}
  public static void agentmain(String options, Instrumentation instrumentation) {
    StringBuilder out = new StringBuilder();
    try {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      Object session = globals.getField("Z02").get(null);
      Object world = field(session.getClass(), "tE0").get(session);
      Object player = field(world.getClass(), "cy").get(world);
      Object wrapper = field(player.getClass(), "F61").get(player);
      Object coordinate = wrapper.getClass().getMethod("lu1").invoke(wrapper);
      for (Class<?> cursor = coordinate.getClass(); cursor != null; cursor = cursor.getSuperclass()) {
        out.append("CLASS ").append(cursor.getName()).append('\n');
        for (Field candidate : cursor.getDeclaredFields()) {
          if (Modifier.isStatic(candidate.getModifiers())) continue;
          try { candidate.trySetAccessible(); out.append(" FIELD ").append(candidate.getName()).append(':').append(candidate.getType().getName()).append('=').append(candidate.get(coordinate)).append('\n'); }
          catch (Throwable error) { out.append(" FIELD ").append(candidate.getName()).append("=<").append(error.getClass().getSimpleName()).append(">\n"); }
        }
        for (Method method : cursor.getDeclaredMethods()) {
          out.append(" METHOD ").append(method.getName()).append('(');
          for (int index = 0; index < method.getParameterCount(); index++) {
            if (index > 0) out.append(',');
            out.append(method.getParameterTypes()[index].getName());
          }
          out.append("): ").append(method.getReturnType().getName());
          if (!Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 0 && method.getReturnType() != void.class) {
            try { method.trySetAccessible(); Object value = method.invoke(coordinate); out.append('=').append(String.valueOf(value)); }
            catch (Throwable error) { out.append("=<").append(error.getClass().getSimpleName()).append('>'); }
          }
          out.append('\n');
        }
      }
    } catch (Throwable error) {
      out.append("ERROR ").append(error).append('\n');
      for (StackTraceElement element : error.getStackTrace()) out.append("  at ").append(element).append('\n');
    }
    try { Files.writeString(Path.of(options), Instant.now() + System.lineSeparator() + out, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING); }
    catch (Throwable ignored) {}
  }
  private static Field field(Class<?> type, String name) throws Exception { for (Class<?> cursor=type;cursor!=null;cursor=cursor.getSuperclass()) try { Field value=cursor.getDeclaredField(name);value.trySetAccessible();return value; } catch(NoSuchFieldException ignored){} throw new NoSuchFieldException(name); }
  private static Class<?> loaded(Instrumentation instrumentation,String name){for(Class<?> type:instrumentation.getAllLoadedClasses())if(type.getName().equals(name))return type;throw new IllegalStateException(name);}
}
