package lab.partydiag;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.Collection;
import java.util.Map;

/** One-shot, read-only inventory of the live world/map objects used by routing. */
public final class MapDiagnosticAgent {
  private MapDiagnosticAgent() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    StringBuilder out = new StringBuilder();
    try {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      Object session = globals.getField("Z02").get(null);
      Object world = field(session.getClass(), "tE0").get(session);
      Object player = field(world.getClass(), "cy").get(world);
      Object position = field(player.getClass(), "F61").get(player);
      Object coordinate = position.getClass().getMethod("lu1").invoke(position);
      Object map = position.getClass().getMethod("WZ0").invoke(position);
      dump(out, "SESSION", session);
      dump(out, "WORLD", world);
      dump(out, "PLAYER", player);
      dump(out, "POSITION", position);
      dump(out, "COORDINATE", coordinate);
      dump(out, "MAP", map);
      probeRouting(out, world, player, coordinate, map);
    } catch (Throwable error) {
      while (error.getCause() != null) error = error.getCause();
      out.append("ERROR ").append(error).append('\n');
      for (StackTraceElement element : error.getStackTrace()) out.append("  at ").append(element).append('\n');
    }
    try {
      Files.writeString(Path.of(options), Instant.now() + System.lineSeparator() + out,
        StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
    } catch (Throwable ignored) {}
  }

  private static void probeRouting(StringBuilder out, Object world, Object player, Object coordinate, Object map) {
    out.append("=== ROUTING_PROBES ===\n");
    try {
      Field gridField = field(map.getClass(), "th0");
      Object grid = gridField.get(map);
      out.append("GRID th0 outer=").append(Array.getLength(grid));
      if (Array.getLength(grid) > 0) out.append(" inner0=").append(Array.getLength(Array.get(grid, 0)));
      out.append('\n');
    } catch (Throwable error) { out.append("GRID_ERROR ").append(error).append('\n'); }

    short x = number(coordinate, "d8").shortValue();
    short y = number(coordinate, "r90").shortValue();
    byte z = number(coordinate, "Xd0").byteValue();
    out.append("CURRENT x=").append(x).append(" y=").append(y).append(" z=").append(z).append('\n');
    for (byte direction = 0; direction < 4; direction++) {
      out.append(" DIR ").append(direction);
      invoke(out, " coord.jk", coordinate, "jk", new Class<?>[]{byte.class}, direction);
      invoke(out, " coord.X02", coordinate, "X02", new Class<?>[]{byte.class}, direction);
      invoke(out, " coord.cON", coordinate, "cON", new Class<?>[]{byte.class}, direction);
      invoke(out, " world.zE", world, "zE", new Class<?>[]{byte.class, loadedFrom(world, "f.iM0")}, direction, coordinate);
      invoke(out, " player.Az", player, "Az", new Class<?>[]{byte.class, loadedFrom(player, "f.iM0")}, direction, coordinate);
      out.append('\n');
    }
    for (int px = x - 2; px <= x + 2; px++) for (int py = y - 2; py <= y + 2; py++) {
      Object tile = null;
      try { tile = map.getClass().getMethod("ky1", int.class, int.class).invoke(map, px, py); }
      catch (Throwable ignored) {}
      out.append(" TILE x=").append(px).append(" y=").append(py).append(' ').append(tileSummary(tile)).append('\n');
    }
  }

  private static void invoke(StringBuilder out, String label, Object target, String name, Class<?>[] parameters, Object... args) {
    try {
      Method method = target.getClass().getMethod(name, parameters);
      Object result = method.invoke(target, args);
      out.append(label).append('=').append(tileSummary(result));
    } catch (Throwable error) { out.append(label).append("=<").append(error.getClass().getSimpleName()).append('>'); }
  }

  private static String tileSummary(Object value) {
    if (value == null) return "null";
    if (value instanceof Boolean || value instanceof Number || value instanceof CharSequence) return String.valueOf(value);
    try {
      return "{" + value.getClass().getName()
        + " x=" + number(value, "d8") + " y=" + number(value, "r90")
        + " terrain=" + number(value, "WU1") + " behavior=" + number(value, "Gh0")
        + " z=" + number(value, "Xd0") + "}";
    } catch (Throwable ignored) { return describe(value); }
  }

  private static Number number(Object value, String method) {
    try { return (Number)value.getClass().getMethod(method).invoke(value); }
    catch (Throwable error) { throw new IllegalStateException(error); }
  }

  private static Class<?> loadedFrom(Object value, String name) {
    try { return Class.forName(name, false, value.getClass().getClassLoader()); }
    catch (ClassNotFoundException error) { throw new IllegalStateException(error); }
  }

  private static void dump(StringBuilder out, String label, Object value) {
    if (value == null) { out.append(label).append(" null\n"); return; }
    out.append("=== ").append(label).append(" type=").append(value.getClass().getName()).append(" ===\n");
    for (Class<?> cursor = value.getClass(); cursor != null && cursor != Object.class; cursor = cursor.getSuperclass()) {
      out.append("CLASS ").append(cursor.getName()).append('\n');
      for (Field candidate : cursor.getDeclaredFields()) {
        if (Modifier.isStatic(candidate.getModifiers())) continue;
        out.append(" FIELD ").append(candidate.getName()).append(':').append(candidate.getType().getTypeName());
        try {
          candidate.trySetAccessible();
          Object item = candidate.get(value);
          out.append('=').append(describe(item));
        } catch (Throwable error) { out.append("=<").append(error.getClass().getSimpleName()).append('>'); }
        out.append('\n');
      }
      for (Method method : cursor.getDeclaredMethods()) {
        if (Modifier.isStatic(method.getModifiers())) continue;
        out.append(" METHOD ").append(method.getName()).append('(');
        for (int index = 0; index < method.getParameterCount(); index++) {
          if (index > 0) out.append(',');
          out.append(method.getParameterTypes()[index].getTypeName());
        }
        out.append("):").append(method.getReturnType().getTypeName());
        if (method.getParameterCount() == 0 && safeReturn(method.getReturnType())) {
          try { method.trySetAccessible(); out.append('=').append(describe(method.invoke(value))); }
          catch (Throwable error) { out.append("=<").append(error.getClass().getSimpleName()).append('>'); }
        }
        out.append('\n');
      }
    }
  }

  private static boolean safeReturn(Class<?> type) {
    return type.isPrimitive() || type == String.class || type.isEnum();
  }

  private static String describe(Object value) {
    if (value == null) return "null";
    Class<?> type = value.getClass();
    if (type.isArray()) return "array(" + type.getComponentType().getTypeName() + ",length=" + Array.getLength(value) + ")";
    if (value instanceof Collection<?> collection) return type.getName() + "(size=" + collection.size() + ")";
    if (value instanceof Map<?,?> map) return type.getName() + "(size=" + map.size() + ")";
    if (value instanceof Number || value instanceof Boolean || value instanceof Character || value instanceof CharSequence || type.isEnum()) return String.valueOf(value);
    return "<" + type.getName() + ">";
  }

  private static Field field(Class<?> type, String name) throws Exception {
    for (Class<?> cursor = type; cursor != null; cursor = cursor.getSuperclass()) try {
      Field value = cursor.getDeclaredField(name); value.trySetAccessible(); return value;
    } catch (NoSuchFieldException ignored) {}
    throw new NoSuchFieldException(name);
  }

  private static Class<?> loaded(Instrumentation instrumentation, String name) {
    for (Class<?> type : instrumentation.getAllLoadedClasses()) if (type.getName().equals(name)) return type;
    throw new IllegalStateException("Class not loaded: " + name);
  }
}
