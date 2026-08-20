package lab.snapshotagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.Arrays;
import java.util.IdentityHashMap;

/** One-shot diagnostic snapshot of the authorized client's live battle model. */
public final class BattleSnapshotAgent {
  private BattleSnapshotAgent() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 2) throw new IllegalArgumentException("Expected LOG_PATH,TAG");
    Thread worker = new Thread(() -> snapshot(Path.of(values[0]), values[1], instrumentation),
      "bridge-battle-snapshot");
    worker.setDaemon(true);
    worker.start();
  }

  private static void snapshot(Path log, String tag, Instrumentation instrumentation) {
    try {
      Class<?> globals = findLoaded(instrumentation, "f.Ot");
      Object battle = globals.getField("Bu").get(null);
      Object screen = globals.getField("B21").get(null);
      write(log, "BEGIN tag=" + tag + " battle=" + type(battle) + " screen=" + type(screen));
      if (battle == null) {
        write(log, "NO_BATTLE");
        return;
      }
      Field teams = battle.getClass().getField("dO");
      Object matrix = teams.get(battle);
      int sides = Array.getLength(matrix);
      for (int side = 0; side < sides; side++) {
        Object row = Array.get(matrix, side);
        for (int slot = 0; slot < Array.getLength(row); slot++) {
          Object pokemon = Array.get(row, slot);
          if (pokemon == null) continue;
          write(log, "POKEMON side=" + side + " slot=" + slot + " " + describe(pokemon));
          write(log, "FIELDS side=" + side + " slot=" + slot + " " + fields(pokemon));
        }
      }
      Object h60 = findByType(screen, "f.h60", 0, new IdentityHashMap<>());
      write(log, "BATTLE_UI " + type(h60));
      if (h60 != null) {
        Object inventoryPanel = field(h60, "eR0");
        write(log, "INVENTORY_PANEL " + fields(inventoryPanel));
      }
      write(log, "END tag=" + tag);
    } catch (Throwable error) {
      write(log, "ERROR tag=" + tag + " " + root(error));
    }
  }

  private static String describe(Object value) {
    String[] getters = {"M81", "Ah", "iR1", "Kh", "KU1", "yQ", "IO", "qy1", "XI1",
      "Fj1", "HB1", "WP1", "ap", "dN1"};
    StringBuilder out = new StringBuilder();
    for (String name : getters) {
      try {
        Method method = value.getClass().getMethod(name);
        Object result = method.invoke(value);
        out.append(name).append('=').append(format(result)).append(' ');
      } catch (Throwable ignored) {}
    }
    return out.toString().trim();
  }

  private static String fields(Object value) {
    if (value == null) return "null";
    StringBuilder out = new StringBuilder(type(value)).append('{');
    for (Class<?> cursor = value.getClass(); cursor != null && cursor != Object.class; cursor = cursor.getSuperclass()) {
      for (Field item : cursor.getDeclaredFields()) {
        if (Modifier.isStatic(item.getModifiers()) || !item.trySetAccessible()) continue;
        try {
          Object fieldValue = item.get(value);
          if (simple(fieldValue) || (fieldValue != null && fieldValue.getClass().isArray())) {
            out.append(item.getName()).append('=').append(format(fieldValue)).append(',');
          } else if (fieldValue != null && (item.getName().equals("d3") || item.getName().equals("oA0") || item.getName().equals("ZU"))) {
            out.append(item.getName()).append('=').append(shallow(fieldValue)).append(',');
          }
        } catch (Throwable ignored) {}
      }
    }
    return out.append('}').toString();
  }

  private static String shallow(Object value) {
    StringBuilder out = new StringBuilder(type(value)).append('{');
    for (Field item : value.getClass().getDeclaredFields()) {
      if (Modifier.isStatic(item.getModifiers()) || !item.trySetAccessible()) continue;
      try {
        Object fieldValue = item.get(value);
        if (simple(fieldValue) || (fieldValue != null && fieldValue.getClass().isArray())) {
          out.append(item.getName()).append('=').append(format(fieldValue)).append(',');
        }
      } catch (Throwable ignored) {}
    }
    return out.append('}').toString();
  }

  private static Object findByType(Object value, String className, int depth, IdentityHashMap<Object, Boolean> seen) {
    if (value == null || depth > 6 || seen.put(value, Boolean.TRUE) != null) return null;
    if (value.getClass().getName().equals(className)) return value;
    if (value.getClass().isArray()) {
      int length = Math.min(Array.getLength(value), 30);
      for (int index = 0; index < length; index++) {
        Object found = findByType(Array.get(value, index), className, depth + 1, seen);
        if (found != null) return found;
      }
      return null;
    }
    if (!value.getClass().getName().startsWith("f.")) return null;
    for (Class<?> cursor = value.getClass(); cursor != null && cursor != Object.class; cursor = cursor.getSuperclass()) {
      for (Field item : cursor.getDeclaredFields()) {
        if (Modifier.isStatic(item.getModifiers()) || !item.trySetAccessible()) continue;
        try {
          Object found = findByType(item.get(value), className, depth + 1, seen);
          if (found != null) return found;
        } catch (Throwable ignored) {}
      }
    }
    return null;
  }

  private static Object field(Object value, String name) throws Exception {
    return value == null ? null : value.getClass().getField(name).get(value);
  }

  private static boolean simple(Object value) {
    return value == null || value instanceof Number || value instanceof Boolean || value instanceof Character || value instanceof String;
  }

  private static String format(Object value) {
    if (value == null) return "null";
    if (!value.getClass().isArray()) return String.valueOf(value).replace('\n', ' ');
    if (value instanceof byte[] bytes) return Arrays.toString(bytes);
    if (value instanceof short[] shorts) return Arrays.toString(shorts);
    if (value instanceof int[] ints) return Arrays.toString(ints);
    if (value instanceof long[] longs) return Arrays.toString(longs);
    if (value instanceof boolean[] booleans) return Arrays.toString(booleans);
    int length = Math.min(Array.getLength(value), 20);
    StringBuilder out = new StringBuilder("[");
    for (int index = 0; index < length; index++) {
      if (index > 0) out.append(',');
      out.append(type(Array.get(value, index)));
    }
    return out.append(']').toString();
  }

  private static String type(Object value) {
    return value == null ? "null" : value.getClass().getName();
  }

  private static Class<?> findLoaded(Instrumentation instrumentation, String name) {
    for (Class<?> candidate : instrumentation.getAllLoadedClasses()) {
      if (candidate.getName().equals(name)) return candidate;
    }
    throw new IllegalStateException("Required class is not loaded: " + name);
  }

  private static Throwable root(Throwable error) {
    Throwable current = error;
    while (current.getCause() != null) current = current.getCause();
    return current;
  }

  private static synchronized void write(Path path, String message) {
    try {
      Path parent = path.toAbsolutePath().getParent();
      if (parent != null) Files.createDirectories(parent);
      Files.writeString(path, Instant.now() + " " + message + System.lineSeparator(),
        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (IOException ignored) {}
  }
}
