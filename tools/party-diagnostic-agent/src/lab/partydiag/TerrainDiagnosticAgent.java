package lab.partydiag;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.nio.file.*;
import java.time.Instant;

/** One-shot report of the official client's coordinate terrain and behavior flags. */
public final class TerrainDiagnosticAgent {
  private TerrainDiagnosticAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation) {
    StringBuilder report = new StringBuilder();
    try {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      Object session = globals.getField("Z02").get(null);
      Object world = field(session.getClass(), "tE0").get(session);
      Object player = field(world.getClass(), "cy").get(world);
      Object wrapper = field(player.getClass(), "F61").get(player);
      Object coordinate = wrapper.getClass().getMethod("lu1").invoke(wrapper);
      report.append("wrapper=").append(wrapper.getClass().getName()).append('\n');
      report.append("coordinate=").append(coordinate == null ? "null" : coordinate.getClass().getName()).append('\n');
      if (coordinate != null) {
        for (Method method : coordinate.getClass().getMethods()) {
          if (method.getParameterCount() == 0 && (method.getReturnType() == short.class || method.getReturnType() == byte.class || method.getReturnType() == boolean.class)) {
            try { report.append(method.getName()).append('=').append(method.invoke(coordinate)).append('\n'); }
            catch (Throwable ignored) {}
          }
        }
        short terrain = ((Number) coordinate.getClass().getMethod("rN1").invoke(coordinate)).shortValue();
        short behavior = ((Number) coordinate.getClass().getMethod("gw1").invoke(coordinate)).shortValue();
        Class<?> formatter = loaded(instrumentation, "f.WJ");
        Method format = formatter.getMethod("EQ1", short.class, boolean.class);
        report.append("terrainId=").append(Short.toUnsignedInt(terrain)).append(" terrain=").append(format.invoke(null, terrain, false)).append('\n');
        report.append("behaviorId=").append(Short.toUnsignedInt(behavior)).append(" behavior=").append(format.invoke(null, behavior, false)).append('\n');
      }
    } catch (Throwable error) {
      report.append("ERROR ").append(error).append('\n');
      for (StackTraceElement element : error.getStackTrace()) report.append("  at ").append(element).append('\n');
    }
    try { Files.writeString(Path.of(options), Instant.now() + System.lineSeparator() + report, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING); }
    catch (Throwable ignored) {}
  }
  private static Field field(Class<?> type, String name) throws Exception {
    for (Class<?> cursor = type; cursor != null; cursor = cursor.getSuperclass()) try { Field value = cursor.getDeclaredField(name); value.trySetAccessible(); return value; }
    catch (NoSuchFieldException ignored) {}
    throw new NoSuchFieldException(name);
  }
  private static Class<?> loaded(Instrumentation instrumentation, String name) {
    for (Class<?> type : instrumentation.getAllLoadedClasses()) if (type.getName().equals(name)) return type;
    throw new IllegalStateException("Class not loaded: " + name);
  }
}
