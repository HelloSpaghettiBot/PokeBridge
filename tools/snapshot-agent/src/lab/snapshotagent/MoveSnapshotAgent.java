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
import java.util.IdentityHashMap;

/** One-shot dump of the live move slots and PP-related fields. */
public final class MoveSnapshotAgent {
  private MoveSnapshotAgent() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = (options == null ? "" : options).split(",", -1);
    Thread worker = new Thread(() -> run(Path.of(values[0]), values[1], instrumentation), "bridge-move-snapshot");
    worker.setDaemon(true);
    worker.start();
  }

  private static void run(Path log, String tag, Instrumentation instrumentation) {
    try {
      Class<?> globals = findLoaded(instrumentation, "f.Ot");
      Object screen = globals.getField("B21").get(null);
      Object ui = findByType(screen, "f.h60", 0, new IdentityHashMap<>());
      if (ui == null) throw new IllegalStateException("Battle UI not found");
      Object slots = ui.getClass().getField("jg1").get(ui);
      write(log, "MOVES_BEGIN tag=" + tag + " slots=" + (slots == null ? -1 : Array.getLength(slots)));
      if (slots != null) {
        for (int index = 0; index < Array.getLength(slots); index++) {
          Object move = Array.get(slots, index);
          if (move == null) continue;
          StringBuilder text = new StringBuilder("MOVE slot=").append(index);
          for (Field field : move.getClass().getDeclaredFields()) {
            if (Modifier.isStatic(field.getModifiers()) || !field.trySetAccessible()) continue;
            Object value = field.get(move);
            if (value == null || value instanceof Number || value instanceof Boolean || value instanceof String) {
              text.append(' ').append(field.getName()).append('=').append(value);
            }
          }
          for (String methodName : new String[]{"aI0", "H4", "pz1", "Zc0", "lw1", "Wj", "MO1", "do1"}) {
            try {
              Method method = move.getClass().getMethod(methodName);
              text.append(' ').append(methodName).append("()=").append(method.invoke(move));
            } catch (Throwable ignored) {}
          }
          write(log, text.toString());
        }
      }
      write(log, "MOVES_END tag=" + tag);
    } catch (Throwable error) {
      write(log, "MOVE_ERROR tag=" + tag + " " + root(error));
    }
  }

  private static Object findByType(Object value, String className, int depth, IdentityHashMap<Object, Boolean> seen) {
    if (value == null || depth > 6 || seen.put(value, Boolean.TRUE) != null) return null;
    if (value.getClass().getName().equals(className)) return value;
    if (value.getClass().isArray()) {
      for (int i = 0; i < Math.min(Array.getLength(value), 30); i++) {
        Object found = findByType(Array.get(value, i), className, depth + 1, seen);
        if (found != null) return found;
      }
      return null;
    }
    if (!value.getClass().getName().startsWith("f.")) return null;
    for (Class<?> cursor = value.getClass(); cursor != null && cursor != Object.class; cursor = cursor.getSuperclass()) {
      for (Field field : cursor.getDeclaredFields()) {
        if (Modifier.isStatic(field.getModifiers()) || !field.trySetAccessible()) continue;
        try {
          Object found = findByType(field.get(value), className, depth + 1, seen);
          if (found != null) return found;
        } catch (Throwable ignored) {}
      }
    }
    return null;
  }

  private static Class<?> findLoaded(Instrumentation instrumentation, String name) {
    for (Class<?> candidate : instrumentation.getAllLoadedClasses()) if (candidate.getName().equals(name)) return candidate;
    throw new IllegalStateException("Class not loaded: " + name);
  }

  private static Throwable root(Throwable error) {
    while (error.getCause() != null) error = error.getCause();
    return error;
  }

  private static synchronized void write(Path path, String message) {
    try {
      Files.writeString(path, Instant.now() + " " + message + System.lineSeparator(),
        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (IOException ignored) {}
  }
}
